"""
Per-metric profile simulator with shared driver modulation.

Each metric has its own daily profile and its own OU noise process,
giving every metric a unique shape and personality. Shared drivers
(client_load, rf_quality, infra_health) add weak cross-metric
correlation — about 20-30% of total variation.

Architecture:
  value = metric_daily_profile(hour) + metric_OU_noise + weak_shared_effect

- metric_daily_profile: deterministic time-of-day curve per metric
- metric_OU_noise: per-metric Ornstein-Uhlenbeck process (Gaussian,
  mean-reverting) providing the bulk of stochastic variation
- weak_shared_effect: small coupling to 3 shared drivers so that
  correlated phenomena (e.g., load spike) ripple across metrics

Three dimensions of the network (following network ops mental model):
- Temporal: Per-metric daily profiles define each metric's rhythm
- Physical: AP topology defines per-AP driver baselines and behavior
- Logical: Network profile (enterprise/campus/hospital) sets overall character

Network profiles are selected via NETWORK_PROFILE environment variable:
- enterprise: Standard office environment (default)
- campus: University with class schedules and dorm usage
- hospital: 24/7 facility with high reliability requirements
"""
import json
import math
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import numpy as np

from simulator.perturbations import PerturbationManager, create_load_perturbation


# --- Default driver parameters ---
# These are used when the config file doesn't specify driver-specific values.
# theta: mean reversion rate (1/s) — higher = faster return to mean
# sigma: noise intensity — controls magnitude of random fluctuations
# normal_level: the "normal" level used as reference for metric derivation
DRIVER_DEFAULTS = {
    "client_load": {
        "theta": 0.002,       # ~6 min half-life: smooth but responsive
        "sigma": 0.004,       # Stationary std ≈ 0.063
        "normal_level": 0.45,
    },
    "rf_quality": {
        "theta": 0.0005,      # ~23 min half-life: very slow drift
        "sigma": 0.001,       # Stationary std ≈ 0.032
        "normal_level": 0.90,
    },
    "infra_health": {
        "theta": 0.0003,      # ~38 min half-life: persistent state
        "sigma": 0.0005,      # Stationary std ≈ 0.020
        "normal_level": 0.95,
    },
}


# --- Shared driver sensitivity (WEAK — ~20-30% of variation) ---
# These produce small cross-metric correlations from demand/environment events.
# Kept deliberately small so shared drivers modulate, not dominate.
# Shared effect = sum(sensitivity * driver_deviation) * metric_range
METRIC_SENSITIVITIES = {
    "capacity": {
        "client_load": 0.12,       # Utilization rises a bit with demand
        "rf_quality": -0.01,
        "infra_health": 0.02,
    },
    "throughput": {
        "client_load": -0.04,      # Contention under load
        "rf_quality": 0.06,
        "infra_health": 0.05,
    },
    "time_to_connect": {
        "client_load": 0.04,       # Auth queue under load
        "rf_quality": -0.02,
        "infra_health": -0.08,     # Infra health matters most here
    },
    "coverage": {
        "client_load": 0.0,        # Zero — signal is physics
        "rf_quality": 0.08,        # RF environment affects RSSI
        "infra_health": 0.0,
    },
    "roaming": {
        "client_load": 0.03,
        "rf_quality": -0.04,
        "infra_health": -0.03,
    },
    "successful_connects": {
        "client_load": -0.01,
        "rf_quality": 0.01,
        "infra_health": 0.06,      # Infra outages kill success rate
    },
    "ap_health": {
        "client_load": -0.02,
        "rf_quality": 0.01,
        "infra_health": 0.30,      # Direct mapping, but moderate
    },
}


# --- Per-metric OU noise (PRIMARY stochastic component — ~70% of variation) ---
# Each metric gets its own OU process producing Gaussian, mean-reverting noise.
# This is what gives each metric its unique "personality" and prevents lockstep.
#
# theta: mean reversion rate (1/s) — higher = faster reversion = less correlated
# sigma: noise intensity — controls spread of the Gaussian distribution
# weight: fraction of metric_range this noise contributes (sets amplitude)
#
# Stationary std of OU = sigma / sqrt(2*theta)
# Typical swing = ±2*std * weight * metric_range (in metric units)
METRIC_OU_NOISE = {
    "coverage": {
        "theta": 0.0003,    # ~38 min half-life: slow RF environment drift
        "sigma": 0.0012,    # Stationary std ≈ 0.049
        "weight": 0.035,    # ±2.7 dBm (2σ swing)
    },
    "throughput": {
        "theta": 0.0006,    # ~19 min half-life: channel quality fluctuation
        "sigma": 0.0020,    # Stationary std ≈ 0.058
        "weight": 0.035,    # ±28 Mbps (2σ swing)
    },
    "time_to_connect": {
        "theta": 0.0008,    # ~14 min half-life: auth/DHCP variability
        "sigma": 0.0025,    # Stationary std ≈ 0.063
        "weight": 0.035,    # ±4.1 ms (2σ swing)
    },
    "capacity": {
        "theta": 0.0005,    # ~23 min half-life
        "sigma": 0.0018,    # Stationary std ≈ 0.057
        "weight": 0.030,    # ±2.3% (2σ swing)
    },
    "roaming": {
        "theta": 0.0004,    # ~29 min half-life: mobility patterns
        "sigma": 0.0015,    # Stationary std ≈ 0.053
        "weight": 0.030,    # ±2.0 ms (2σ swing)
    },
    "successful_connects": {
        "theta": 0.0002,    # ~58 min half-life: very persistent
        "sigma": 0.0006,    # Stationary std ≈ 0.030
        "weight": 0.020,    # ±0.23% (2σ swing) — still tight
    },
    "ap_health": {
        "theta": 0.0002,    # ~58 min half-life: firmware/thermal drift
        "sigma": 0.0008,    # Stationary std ≈ 0.040
        "weight": 0.025,    # ±1.4% (2σ swing)
    },
}


# Available network profiles
NETWORK_PROFILES = {
    "enterprise": "config_enterprise.json",
    "campus": "config_campus.json",
    "hospital": "config_hospital.json",
}
DEFAULT_PROFILE = "enterprise"


def get_config_path() -> Path:
    """Get config path based on NETWORK_PROFILE environment variable."""
    profile = os.environ.get("NETWORK_PROFILE", DEFAULT_PROFILE).lower()

    if profile not in NETWORK_PROFILES:
        print(f"Warning: Unknown NETWORK_PROFILE '{profile}', using '{DEFAULT_PROFILE}'")
        profile = DEFAULT_PROFILE

    config_path = Path(__file__).parent / NETWORK_PROFILES[profile]

    if not config_path.exists():
        print(f"Warning: Config file not found, using config.json")
        config_path = Path(__file__).parent / "config.json"

    print(f"Using network profile: {profile} ({config_path.name})")
    return config_path


class RealisticMetricsGenerator:
    """Generate realistic network metrics from underlying physical drivers."""

    DRIVERS = ["client_load", "rf_quality", "infra_health"]

    ENTITIES = [
        "AP-Floor1-01", "AP-Floor1-02",
        "AP-Floor2-01", "AP-Floor2-02",
        "AP-Floor3-01", "AP-Floor3-02",
    ]

    def __init__(self, start_time: int = None, config_path: str = None):
        """
        Initialize the driver-based metrics generator.

        Args:
            start_time: Unix timestamp to start from (defaults to now)
            config_path: Path to config JSON (uses NETWORK_PROFILE if None)
        """
        self.start_time = start_time or int(time.time())
        self.current_offset = 0

        # Load configuration
        if config_path is None:
            config_path = get_config_path()
        with open(config_path, 'r') as f:
            self.config = json.load(f)

        # AP topology from config
        self._topology = self.config.get("ap_topology", {})

        # Driver parameters (config overrides defaults)
        self._driver_config = {}
        cfg_drivers = self.config.get("drivers", {})
        for driver in self.DRIVERS:
            defaults = DRIVER_DEFAULTS[driver]
            driver_cfg = cfg_drivers.get(driver, {})
            self._driver_config[driver] = {
                "theta": driver_cfg.get("theta", defaults["theta"]),
                "sigma": driver_cfg.get("sigma", defaults["sigma"]),
                "normal_level": driver_cfg.get("normal_level", defaults["normal_level"]),
            }

        # Per-AP driver state (shared drivers)
        self._driver_state: Dict[str, Dict[str, float]] = {}
        self._last_update_time: Dict[str, int] = {}

        # Per-AP independent metric noise state
        # Key: entity_key, Value: {metric_name: float} (current noise level)
        self._metric_noise_state: Dict[str, Dict[str, float]] = {}
        self._metric_noise_last_update: Dict[str, int] = {}

        # Initialize per-entity state
        for entity in self.ENTITIES:
            self._init_entity_state(entity, self.start_time)

        # Global state for queries without entity
        self._init_entity_state("_global", self.start_time)

        # Perturbation manager
        self.perturbation_manager = PerturbationManager()

        # RNG seeded from start_time for reproducibility within a session
        self._rng = np.random.RandomState(abs(self.start_time) % (2**31))

        # Track last load pattern injection time
        self._last_load_check = self.start_time

    def generate_observation(
        self, metric: str, timestamp: int = None, entity: str = None
    ) -> Dict:
        """
        Generate a single metric observation by deriving from driver state.

        Args:
            metric: Metric name (e.g., "throughput", "ap_health")
            timestamp: Unix timestamp (defaults to current generator time)
            entity: Optional AP entity for per-AP variation

        Returns:
            Observation dict with timestamp, metric, value
        """
        if metric not in self.get_all_metrics():
            raise ValueError(f"Unknown metric: {metric}")

        ts = timestamp or (self.start_time + self.current_offset)
        entity_key = entity or "_global"

        # Ensure entity exists in state
        if entity_key not in self._driver_state:
            self._init_entity_state(entity_key, ts)

        # Update drivers for this entity at this timestamp
        drivers = self._update_drivers(entity_key, ts)

        # Derive metric value from daily profile + OU noise + shared drivers
        value = self._derive_metric(metric, drivers, entity_key, timestamp=ts)

        # Inject load patterns during business hours
        self._maybe_inject_load_patterns(ts)

        result = {
            "timestamp": ts,
            "metric": metric,
            "value": round(value, 2),
        }
        if entity is not None:
            result["entity"] = entity

        return result

    def _init_entity_state(self, entity_key: str, timestamp: int) -> None:
        """Initialize shared driver state and independent metric noise for an entity."""
        entity = entity_key if entity_key != "_global" else None

        # Shared driver state
        self._driver_state[entity_key] = {}
        for driver in self.DRIVERS:
            self._driver_state[entity_key][driver] = self._driver_mean(
                driver, entity, timestamp
            )
        self._last_update_time[entity_key] = timestamp

        # Independent metric noise state (starts at 0 = no deviation)
        self._metric_noise_state[entity_key] = {}
        for metric in self.get_all_metrics():
            self._metric_noise_state[entity_key][metric] = 0.0
        self._metric_noise_last_update[entity_key] = timestamp

    def _update_drivers(self, entity_key: str, timestamp: int) -> Dict[str, float]:
        """
        Update shared driver state and independent metric noise using OU processes.

        The OU process produces smooth, mean-reverting curves:
        x(t+dt) = μ + (x(t) - μ) * exp(-θ*dt) + noise

        Returns shared driver values with perturbation effects applied.
        Independent metric noise is updated as a side-effect and read by _derive_metric.
        """
        last_t = self._last_update_time.get(entity_key, timestamp)
        dt = max(0, timestamp - last_t)
        entity = entity_key if entity_key != "_global" else None

        if dt > 0:
            # OU process update for each shared driver
            for driver in self.DRIVERS:
                cfg = self._driver_config[driver]
                theta = cfg["theta"]
                sigma = cfg["sigma"]

                # Time-varying mean
                mu = self._driver_mean(driver, entity, timestamp)

                # Current state
                x = self._driver_state[entity_key][driver]

                # Exact OU update (works for any dt, including large bootstrap gaps)
                decay = math.exp(-theta * dt)

                if theta > 0:
                    noise_var = (sigma ** 2) / (2 * theta) * (1 - math.exp(-2 * theta * dt))
                    noise_std = math.sqrt(max(0, noise_var))
                else:
                    noise_std = 0

                x_new = mu + (x - mu) * decay + noise_std * self._rng.normal()
                self._driver_state[entity_key][driver] = float(np.clip(x_new, 0.0, 1.0))

            # OU process update for each per-metric noise
            for metric, noise_cfg in METRIC_OU_NOISE.items():
                theta_m = noise_cfg["theta"]
                sigma_m = noise_cfg["sigma"]

                x = self._metric_noise_state[entity_key].get(metric, 0.0)

                # Mean-reverting to 0 (noise is centered)
                decay = math.exp(-theta_m * dt)
                if theta_m > 0:
                    noise_var = (sigma_m ** 2) / (2 * theta_m) * (1 - math.exp(-2 * theta_m * dt))
                    noise_std = math.sqrt(max(0, noise_var))
                else:
                    noise_std = 0

                x_new = x * decay + noise_std * self._rng.normal()
                self._metric_noise_state[entity_key][metric] = float(np.clip(x_new, -0.5, 0.5))

            self._last_update_time[entity_key] = timestamp
            self._metric_noise_last_update[entity_key] = timestamp

        # Build driver values with perturbation effects
        drivers = {}
        for driver in self.DRIVERS:
            base = self._driver_state[entity_key][driver]
            pert_effect = self.perturbation_manager.total_effect(driver, timestamp)
            drivers[driver] = float(np.clip(base + pert_effect, 0.0, 1.0))

        return drivers

    def _driver_mean(self, driver: str, entity: Optional[str], timestamp: int) -> float:
        """
        Compute the time-varying mean for a driver, adjusted for AP topology.

        The mean follows daily/weekly rhythms, shifted by per-AP characteristics.
        """
        dt = datetime.fromtimestamp(timestamp)
        hour = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
        weekday = dt.weekday()  # 0=Monday, 6=Sunday
        is_weekend = weekday >= 5  # Saturday=5, Sunday=6

        if driver == "client_load":
            base_mean = self._client_load_daily(hour)

            # Weekend reduction
            if is_weekend:
                base_mean *= 0.4

            # Per-AP topology offset
            if entity and entity in self._topology:
                ap_baseline = self._topology[entity].get("load_baseline", 0.45)
                base_mean += (ap_baseline - 0.45)

        elif driver == "rf_quality":
            base_mean = self._driver_config["rf_quality"]["normal_level"]

            # Slightly more interference during business hours (more devices)
            if 9 <= hour <= 17:
                base_mean -= 0.02

            # Per-AP topology offset
            if entity and entity in self._topology:
                ap_rf = self._topology[entity].get("rf_baseline", 0.90)
                base_mean += (ap_rf - 0.90)

        elif driver == "infra_health":
            # Infrastructure health has no daily pattern — it's event-driven
            base_mean = self._driver_config["infra_health"]["normal_level"]

        else:
            base_mean = 0.5

        return float(np.clip(base_mean, 0.0, 1.0))

    def _client_load_daily(self, hour: float) -> float:
        """
        Smooth daily curve for client_load driver.

        Produces a realistic business-hours pattern with:
        - Low overnight baseline (~0.08)
        - Morning ramp-up (6-9)
        - Morning plateau with slight variation (9-12)
        - Lunch dip (12-13)
        - Afternoon peak (13-16)
        - Evening decline (16-19)
        - Low evening/night (19-24)
        """
        if hour < 6:
            return 0.08
        elif hour < 9:
            t = (hour - 6) / 3.0
            return 0.08 + 0.40 * (0.5 - 0.5 * math.cos(math.pi * t))
        elif hour < 12:
            return 0.48 + 0.06 * math.sin(math.pi * (hour - 9) / 3.0)
        elif hour < 13:
            return 0.48 - 0.06 * math.sin(math.pi * (hour - 12))
        elif hour < 16:
            t = (hour - 13) / 3.0
            return 0.48 + 0.18 * math.sin(math.pi * t)
        elif hour < 19:
            t = (hour - 16) / 3.0
            return 0.56 - 0.40 * (0.5 - 0.5 * math.cos(math.pi * t))
        elif hour < 23:
            t = (hour - 19) / 4.0
            return 0.16 - 0.08 * t
        else:
            return 0.08

    def _metric_daily_profile(self, metric: str, hour: float) -> float:
        """
        Return the deterministic daily profile value for a metric at given hour.

        Each metric has its own realistic daily shape. These are the primary
        shapers of the 24-hour pattern — OU noise and shared drivers modulate
        around these curves.

        Returns the value in metric units (not normalized).
        """
        cfg = self.config[metric]
        baseline = cfg["baseline"]

        if metric == "coverage":
            # RSSI is physics: flat all day. Tiny diurnal RF interference.
            # Slightly worse during business hours (more 2.4GHz interference)
            if 9 <= hour <= 17:
                return baseline - 0.3  # -0.3 dBm from co-channel interference
            return baseline

        elif metric == "throughput":
            # Higher throughput overnight (less contention), dip at peak hours
            # Shape: inverse of load — more users = more contention
            if hour < 6:
                return baseline + 18  # ~498 Mbps overnight
            elif hour < 9:
                t = (hour - 6) / 3.0
                return baseline + 18 - 22 * (0.5 - 0.5 * math.cos(math.pi * t))
            elif hour < 12:
                # Morning work: moderate contention
                return baseline - 4 + 3 * math.sin(math.pi * (hour - 9) / 3.0)
            elif hour < 13:
                # Lunch: slight relief
                return baseline - 2
            elif hour < 16:
                # Afternoon peak: heaviest contention
                t = (hour - 13) / 3.0
                return baseline - 4 - 6 * math.sin(math.pi * t)
            elif hour < 19:
                # Evening decline
                t = (hour - 16) / 3.0
                return baseline - 4 + 14 * (0.5 - 0.5 * math.cos(math.pi * t))
            elif hour < 23:
                t = (hour - 19) / 4.0
                return baseline + 10 + 8 * t
            else:
                return baseline + 18

        elif metric == "capacity":
            # % utilization: tracks demand. Low overnight, peaks afternoon.
            if hour < 6:
                return baseline - 10  # ~32% overnight
            elif hour < 9:
                t = (hour - 6) / 3.0
                return baseline - 10 + 12 * (0.5 - 0.5 * math.cos(math.pi * t))
            elif hour < 12:
                return baseline + 2 + 2 * math.sin(math.pi * (hour - 9) / 3.0)
            elif hour < 13:
                return baseline + 2 - 1 * math.sin(math.pi * (hour - 12))
            elif hour < 16:
                t = (hour - 13) / 3.0
                return baseline + 2 + 5 * math.sin(math.pi * t)
            elif hour < 19:
                t = (hour - 16) / 3.0
                return baseline + 2 - 10 * (0.5 - 0.5 * math.cos(math.pi * t))
            elif hour < 23:
                t = (hour - 19) / 4.0
                return baseline - 8 - 2 * t
            else:
                return baseline - 10

        elif metric == "time_to_connect":
            # Faster overnight (no contention), slower at peak (auth queues)
            if hour < 6:
                return baseline - 5  # ~30ms overnight
            elif hour < 9:
                t = (hour - 6) / 3.0
                return baseline - 5 + 7 * (0.5 - 0.5 * math.cos(math.pi * t))
            elif hour < 12:
                return baseline + 2 + 1.5 * math.sin(math.pi * (hour - 9) / 3.0)
            elif hour < 13:
                return baseline + 1.5
            elif hour < 16:
                t = (hour - 13) / 3.0
                return baseline + 2 + 3 * math.sin(math.pi * t)
            elif hour < 19:
                t = (hour - 16) / 3.0
                return baseline + 2 - 6 * (0.5 - 0.5 * math.cos(math.pi * t))
            elif hour < 23:
                t = (hour - 19) / 4.0
                return baseline - 4 - 1 * t
            else:
                return baseline - 5

        elif metric == "roaming":
            # Handoff time: lower overnight (nobody moving), peaks daytime.
            # Different shape from capacity — peaks mid-morning (class changes)
            if hour < 6:
                return baseline - 4  # ~51ms overnight
            elif hour < 9:
                t = (hour - 6) / 3.0
                return baseline - 4 + 7 * (0.5 - 0.5 * math.cos(math.pi * t))
            elif hour < 11:
                # Mid-morning peak (people moving between meetings)
                t = (hour - 9) / 2.0
                return baseline + 3 + 2 * math.sin(math.pi * t)
            elif hour < 13:
                return baseline + 3 - 1.5 * math.sin(math.pi * (hour - 11) / 2.0)
            elif hour < 15:
                return baseline + 1.5
            elif hour < 19:
                t = (hour - 15) / 4.0
                return baseline + 1.5 - 5 * (0.5 - 0.5 * math.cos(math.pi * t))
            elif hour < 23:
                t = (hour - 19) / 4.0
                return baseline - 3.5 - 0.5 * t
            else:
                return baseline - 4

        elif metric == "successful_connects":
            # Very stable. Tiny morning dip from auth surge, otherwise flat.
            if 8 <= hour <= 10:
                t = (hour - 8) / 2.0
                return baseline - 0.15 * math.sin(math.pi * t)
            return baseline

        elif metric == "ap_health":
            # Mostly stable. Slight dip 4-6am (maintenance windows, memory
            # pressure after long uptime), recovers by morning.
            if 3 <= hour <= 7:
                t = (hour - 3) / 4.0
                return baseline - 0.6 * math.sin(math.pi * t)
            # Minor load-related heat/memory during peak afternoon
            if 13 <= hour <= 17:
                t = (hour - 13) / 4.0
                return baseline - 0.25 * math.sin(math.pi * t)
            return baseline

        return baseline

    def _derive_metric(self, metric: str, drivers: Dict[str, float],
                       entity_key: str = "_global",
                       timestamp: int = None) -> float:
        """
        Derive a metric value from:
          1. Per-metric daily profile (deterministic shape)
          2. Per-metric OU noise (Gaussian, metric-specific variation)
          3. Weak shared driver effect (cross-metric correlation)

        value = daily_profile(hour) + OU_noise * weight * range + shared_effect * range
        """
        cfg = self.config[metric]
        metric_range = cfg["max"] - cfg["min"]
        sensitivities = METRIC_SENSITIVITIES[metric]

        # 1. Per-metric daily profile: deterministic baseline by hour
        ts = timestamp or (self.start_time + self.current_offset)
        dt = datetime.fromtimestamp(ts)
        hour = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
        profile_value = self._metric_daily_profile(metric, hour)

        # 2. Per-metric OU noise (primary stochastic component)
        noise_cfg = METRIC_OU_NOISE.get(metric, {})
        noise_weight = noise_cfg.get("weight", 0.0)
        noise_state = self._metric_noise_state.get(entity_key, {}).get(metric, 0.0)
        ou_noise = noise_state * noise_weight * metric_range

        # 3. Weak shared driver effect
        shared_effect = 0.0
        for driver, sensitivity in sensitivities.items():
            normal = self._driver_config[driver]["normal_level"]
            deviation = drivers.get(driver, normal) - normal
            shared_effect += sensitivity * deviation
        shared_contribution = shared_effect * metric_range

        value = profile_value + ou_noise + shared_contribution
        return float(np.clip(value, cfg["min"], cfg["max"]))

    def _maybe_inject_load_patterns(self, timestamp: int) -> None:
        """Randomly inject load pattern perturbations during business hours."""
        if timestamp - self._last_load_check < 10:
            return
        self._last_load_check = timestamp

        dt = datetime.fromtimestamp(timestamp)
        hour = dt.hour + dt.minute / 60.0
        if not (8 <= hour <= 18):
            return

        # Meeting room surge: ~3 per 10-hour business day
        if self._rng.random() < 0.3 / 360:
            p = create_load_perturbation("meeting_room_surge", timestamp)
            if p:
                self.perturbation_manager.add(p)

        # Large download: ~1 per business day
        if self._rng.random() < 0.1 / 360:
            p = create_load_perturbation("large_download", timestamp)
            if p:
                self.perturbation_manager.add(p)

    def tick(self, interval_seconds: int = 10) -> None:
        """Advance time for the generator."""
        self.current_offset += interval_seconds

    def generate_all_metrics_at(
        self, timestamp: int, entity: str
    ) -> Dict[str, float]:
        """
        Generate all metric values for one entity at one timestamp.

        More efficient than calling generate_observation() for each metric,
        because drivers are updated only once per (entity, timestamp).

        Args:
            timestamp: Unix timestamp
            entity: AP entity name

        Returns:
            Dict mapping metric name to rounded value
        """
        # Ensure entity exists in state
        if entity not in self._driver_state:
            self._init_entity_state(entity, timestamp)

        # Update drivers once for this entity/timestamp
        drivers = self._update_drivers(entity, timestamp)

        # Derive all metrics from daily profile + OU noise + shared drivers
        result = {}
        for metric in self.get_all_metrics():
            result[metric] = round(self._derive_metric(metric, drivers, entity, timestamp=timestamp), 2)
        return result

    @classmethod
    def get_all_metrics(cls) -> List[str]:
        """Get list of all available metric names."""
        return [
            "time_to_connect",
            "throughput",
            "coverage",
            "capacity",
            "roaming",
            "successful_connects",
            "ap_health",
        ]


# --- Singleton access ---

_generator_instance = None


def get_generator(start_time: int = None) -> RealisticMetricsGenerator:
    """Get or create the global metrics generator instance."""
    global _generator_instance
    if _generator_instance is None:
        _generator_instance = RealisticMetricsGenerator(start_time)
    return _generator_instance


def reset_generator() -> None:
    """Reset the singleton instance."""
    global _generator_instance
    _generator_instance = None


def reset_for_live_streaming(start_time: int = None) -> None:
    """
    Reset generator for live streaming while preserving driver state.

    After bootstrap, the generator has start_time from days ago.
    This resets to current time while keeping driver state and perturbations
    so live data flows smoothly from historical data.
    """
    global _generator_instance
    if _generator_instance is not None:
        # Preserve state for continuity
        preserved_drivers = {
            k: dict(v) for k, v in _generator_instance._driver_state.items()
        }
        preserved_noise = {
            k: dict(v) for k, v in _generator_instance._metric_noise_state.items()
        }
        preserved_perturbations = _generator_instance.perturbation_manager

        new_start = start_time if start_time is not None else int(time.time())
        _generator_instance = RealisticMetricsGenerator(start_time=new_start)

        # Restore preserved state
        _generator_instance._driver_state = preserved_drivers
        _generator_instance._metric_noise_state = preserved_noise
        _generator_instance.perturbation_manager = preserved_perturbations

        # Reset update times to new start
        for key in _generator_instance._last_update_time:
            _generator_instance._last_update_time[key] = new_start
        for key in _generator_instance._metric_noise_last_update:
            _generator_instance._metric_noise_last_update[key] = new_start
