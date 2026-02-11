"""
Driver-based metrics generator.

Instead of generating metric values directly with noise, this simulator
models three underlying continuous drivers that represent the physical
reality of the network:

- client_load: Demand from connected devices (0-1)
- rf_quality: Radio frequency environment quality (0-1)
- infra_health: Infrastructure hardware/software state (0-1)

Metrics are DERIVED from these drivers via sensitivity functions. This
produces naturally correlated, smooth, realistic traces because:

1. Drivers evolve via Ornstein-Uhlenbeck process (smooth, mean-reverting)
2. Multiple metrics respond to the same driver change (natural correlation)
3. Events perturb drivers, which cascade to all affected metrics

Three dimensions of the network (following network ops mental model):
- Temporal: Time-of-day patterns drive the client_load daily rhythm
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


# --- Metric sensitivity matrix ---
# How each metric responds to driver deviations from normal.
# Value = baseline + sum(sensitivity * driver_deviation * metric_range)
# where driver_deviation = current_driver_value - normal_level
#
# Positive sensitivity: metric increases when driver increases
# Negative sensitivity: metric decreases when driver increases
METRIC_SENSITIVITIES = {
    "capacity": {
        "client_load": 0.70,       # Capacity directly tracks demand
        "rf_quality": -0.05,       # Bad RF slightly reduces usable capacity
        "infra_health": 0.15,      # Unhealthy infra reduces capacity
    },
    "throughput": {
        "client_load": -0.25,      # High load = contention = lower throughput
        "rf_quality": 0.20,        # Good RF = better throughput
        "infra_health": 0.30,      # Healthy infra = better throughput
    },
    "time_to_connect": {
        "client_load": 0.30,       # High load = longer connection setup
        "rf_quality": -0.25,       # Bad RF = longer connections
        "infra_health": -0.40,     # Unhealthy infra = much longer connections
    },
    "coverage": {
        "client_load": -0.02,      # Negligible load effect on signal
        "rf_quality": 0.50,        # RF quality is the primary driver
        "infra_health": 0.05,      # Minor infra effect
    },
    "roaming": {
        "client_load": 0.20,       # More clients = more contention during roam
        "rf_quality": -0.20,       # Bad RF = worse roaming handoffs
        "infra_health": -0.20,     # Unhealthy AP = worse handoffs
    },
    "successful_connects": {
        "client_load": -0.08,      # High load = some failures
        "rf_quality": 0.05,        # RF has minor effect
        "infra_health": 0.30,      # Health is the big driver of failures
    },
    "ap_health": {
        "client_load": -0.10,      # Overloaded AP degrades health score
        "rf_quality": 0.05,        # RF has minor effect on health
        "infra_health": 1.50,      # Direct mapping from driver to metric
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

        # Per-AP driver state
        self._driver_state: Dict[str, Dict[str, float]] = {}
        self._last_update_time: Dict[str, int] = {}

        # Initialize per-entity driver state
        for entity in self.ENTITIES:
            self._driver_state[entity] = {}
            for driver in self.DRIVERS:
                self._driver_state[entity][driver] = self._driver_mean(
                    driver, entity, self.start_time
                )
            self._last_update_time[entity] = self.start_time

        # Global state for queries without entity
        self._driver_state["_global"] = {}
        for driver in self.DRIVERS:
            self._driver_state["_global"][driver] = self._driver_mean(
                driver, None, self.start_time
            )
        self._last_update_time["_global"] = self.start_time

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

        # Derive metric value from drivers
        value = self._derive_metric(metric, drivers)

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
        """Initialize driver state for a new entity."""
        entity = entity_key if entity_key != "_global" else None
        self._driver_state[entity_key] = {}
        for driver in self.DRIVERS:
            self._driver_state[entity_key][driver] = self._driver_mean(
                driver, entity, timestamp
            )
        self._last_update_time[entity_key] = timestamp

    def _update_drivers(self, entity_key: str, timestamp: int) -> Dict[str, float]:
        """
        Update driver state using Ornstein-Uhlenbeck process and apply perturbations.

        The OU process produces smooth, mean-reverting curves:
        x(t+dt) = μ + (x(t) - μ) * exp(-θ*dt) + noise

        Returns driver values with perturbation effects applied.
        """
        last_t = self._last_update_time.get(entity_key, timestamp)
        dt = max(0, timestamp - last_t)
        entity = entity_key if entity_key != "_global" else None

        if dt > 0:
            # OU process update for each driver
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

            self._last_update_time[entity_key] = timestamp

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
        hour = (timestamp % 86400) / 3600.0
        weekday = (timestamp // 86400 + 3) % 7  # 0=Sunday

        if driver == "client_load":
            base_mean = self._client_load_daily(hour)

            # Weekend reduction
            if weekday in (0, 6):
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

    def _derive_metric(self, metric: str, drivers: Dict[str, float]) -> float:
        """
        Derive a metric value from current driver levels.

        Uses the sensitivity matrix to compute how far each driver's deviation
        from normal shifts the metric from its baseline.

        value = baseline + sum(sensitivity * deviation * metric_range)
        """
        cfg = self.config[metric]
        baseline = cfg["baseline"]
        metric_range = cfg["max"] - cfg["min"]
        sensitivities = METRIC_SENSITIVITIES[metric]

        total_effect = 0.0
        for driver, sensitivity in sensitivities.items():
            normal = self._driver_config[driver]["normal_level"]
            deviation = drivers.get(driver, normal) - normal
            total_effect += sensitivity * deviation

        value = baseline + total_effect * metric_range
        return float(np.clip(value, cfg["min"], cfg["max"]))

    def _maybe_inject_load_patterns(self, timestamp: int) -> None:
        """Randomly inject load pattern perturbations during business hours."""
        if timestamp - self._last_load_check < 10:
            return
        self._last_load_check = timestamp

        hour = (timestamp % 86400) / 3600.0
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
        preserved_perturbations = _generator_instance.perturbation_manager

        new_start = start_time if start_time is not None else int(time.time())
        _generator_instance = RealisticMetricsGenerator(start_time=new_start)

        # Restore preserved state
        _generator_instance._driver_state = preserved_drivers
        _generator_instance.perturbation_manager = preserved_perturbations

        # Reset update times to new start
        for key in _generator_instance._last_update_time:
            _generator_instance._last_update_time[key] = new_start
