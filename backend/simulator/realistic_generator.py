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
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
import numpy as np

from simulator.perturbations import PerturbationManager, create_load_perturbation


# --- Classifier definitions (Phase 1: Classifier Simulation Engine) ---
# Classifiers are the simulation primitive. Each represents a specific
# infrastructure sub-component with its own OU process.
# Values are normalized 0.0-1.0 where 1.0 = perfect/healthy.
# Thresholds (green/yellow/red) are derived from bootstrap percentiles.
CLASSIFIER_DEFINITIONS = {
    # Connection sub-components (successful_connects, time_to_connect)
    "association": {
        "theta": 0.0003,
        "sigma": 0.0008,
        "initial_level": 0.98,
        "description": "802.11 association success rate"
    },
    "authorization": {
        "theta": 0.0004,
        "sigma": 0.0010,
        "initial_level": 0.97,
        "description": "RADIUS/802.1X auth success rate"
    },
    "dhcp": {
        "theta": 0.0003,
        "sigma": 0.0006,
        "initial_level": 0.99,
        "description": "DHCP lease acquisition success rate"
    },
    "dns": {
        "theta": 0.0002,
        "sigma": 0.0004,
        "initial_level": 0.995,
        "description": "DNS resolution success rate"
    },
    
    # Capacity sub-components
    "client_density": {
        "theta": 0.0005,
        "sigma": 0.0015,
        "initial_level": 0.70,
        "description": "Client density (inverse - lower density = healthier)"
    },
    "cochannel_interference": {
        "theta": 0.0003,
        "sigma": 0.0010,
        "initial_level": 0.85,
        "description": "Co-channel interference level (inverse)"
    },
    "nonwifi_interference": {
        "theta": 0.0002,
        "sigma": 0.0005,
        "initial_level": 0.95,
        "description": "Non-WiFi interference level (inverse)"
    },
    
    # Throughput sub-components
    "airtime_utilization": {
        "theta": 0.0006,
        "sigma": 0.0020,
        "initial_level": 0.65,
        "description": "Airtime utilization efficiency"
    },
    "channel_width": {
        "theta": 0.0001,
        "sigma": 0.0003,
        "initial_level": 0.90,
        "description": "Channel width availability (80/160MHz)"
    },
    "retry_rate": {
        "theta": 0.0005,
        "sigma": 0.0012,
        "initial_level": 0.88,
        "description": "Frame retry rate (inverse - lower retries = healthier)"
    },
    
    # Coverage sub-components
    "signal_strength": {
        "theta": 0.0003,
        "sigma": 0.0008,
        "initial_level": 0.82,
        "description": "RF signal strength quality"
    },
    "ap_density": {
        "theta": 0.0001,
        "sigma": 0.0002,
        "initial_level": 0.88,
        "description": "AP deployment density"
    },
    "cell_overlap": {
        "theta": 0.0002,
        "sigma": 0.0005,
        "initial_level": 0.85,
        "description": "Cell overlap and coverage redundancy"
    },
    
    # Roaming sub-components
    "handoff_latency": {
        "theta": 0.0004,
        "sigma": 0.0015,
        "initial_level": 0.80,
        "description": "802.11 handoff latency (inverse)"
    },
    "rssi_tuning": {
        "theta": 0.0002,
        "sigma": 0.0005,
        "initial_level": 0.85,
        "description": "RSSI threshold tuning quality"
    },
    "80211rk_support": {
        "theta": 0.0001,
        "sigma": 0.0002,
        "initial_level": 0.92,
        "description": "802.11r/k fast roaming support"
    },
    
    # AP Health sub-components
    "cpu": {
        "theta": 0.0003,
        "sigma": 0.0010,
        "initial_level": 0.85,
        "description": "CPU utilization (inverse)"
    },
    "memory": {
        "theta": 0.0002,
        "sigma": 0.0008,
        "initial_level": 0.88,
        "description": "Memory pressure (inverse)"
    },
    "uptime": {
        "theta": 0.0001,
        "sigma": 0.0005,
        "initial_level": 0.98,
        "description": "Uptime stability (crashes reduce this)"
    },
    "temperature": {
        "theta": 0.0002,
        "sigma": 0.0006,
        "initial_level": 0.90,
        "description": "Device temperature (inverse)"
    },
}


# --- Metric-to-classifier mappings ---
# Each metric is computed from 2-4 classifiers with defined weights.
# Weights determine each classifier's contribution to the metric value.
METRIC_CLASSIFIERS = {
    "successful_connects": {
        "association": 0.20,
        "authorization": 0.25,
        "dhcp": 0.40,
        "dns": 0.15,
    },
    "time_to_connect": {
        "association": 0.20,
        "authorization": 0.25,
        "dhcp": 0.40,
        "dns": 0.15,
    },
    "capacity": {
        "client_density": 0.50,
        "cochannel_interference": 0.30,
        "nonwifi_interference": 0.20,
    },
    "throughput": {
        "airtime_utilization": 0.45,
        "channel_width": 0.25,
        "retry_rate": 0.30,
    },
    "coverage": {
        "signal_strength": 0.50,
        "ap_density": 0.30,
        "cell_overlap": 0.20,
    },
    "roaming": {
        "handoff_latency": 0.50,
        "rssi_tuning": 0.30,
        "80211rk_support": 0.20,
    },
    "ap_health": {
        "cpu": 0.30,
        "memory": 0.25,
        "uptime": 0.30,
        "temperature": 0.15,
    },
}


# --- Environmental condition: client_load ---
# client_load is kept as the sole environmental condition (not a classifier).
# It models diurnal human activity and modulates classifier behavior.
CLIENT_LOAD_CONFIG = {
    "theta": 0.002,       # ~6 min half-life: smooth but responsive
    "sigma": 0.004,       # Stationary std ≈ 0.063
    "normal_level": 0.45,
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
    """Generate realistic network metrics from classifier-based simulation."""

    ENTITIES = [
        "AP-Floor1-01", "AP-Floor1-02",
        "AP-Floor2-01", "AP-Floor2-02",
        "AP-Floor3-01", "AP-Floor3-02",
    ]

    def __init__(self, start_time: int = None, config_path: str = None):
        """
        Initialize the classifier-based metrics generator.

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

        # Classifier state (shared pool)
        # Key: classifier name, Value: float (current value 0.0-1.0)
        self._classifier_state: Dict[str, float] = {}
        
        # Classifier thresholds (loaded from baselines.json)
        # Key: classifier name, Value: Dict[hour]->Dict[green_min, yellow_min]
        self._classifier_thresholds: Dict[str, Dict[int, Dict[str, float]]] = {}
        
        # Client load state (environmental condition)
        # Key: entity_key, Value: float
        self._client_load_state: Dict[str, float] = {}
        
        # Last update times
        self._last_update_time: Dict[str, int] = {}

        # Initialize global state
        self._init_entity_state("_global", self.start_time)

        # Initialize per-entity state
        for entity in self.ENTITIES:
            self._init_entity_state(entity, self.start_time)

        # Perturbation manager
        self.perturbation_manager = PerturbationManager()

        # RNG seeded from start_time for reproducibility within a session
        self._rng = np.random.RandomState(abs(self.start_time) % (2**31))

        # Track last load pattern injection time
        self._last_load_check = self.start_time
        
        # Load classifier thresholds from baselines if available
        self._load_classifier_thresholds()

    def generate_observation(
        self, metric: str, timestamp: int = None, entity: str = None, include_classifiers: bool = False
    ) -> Dict:
        """
        Generate a single metric observation by deriving from classifier state.

        Args:
            metric: Metric name (e.g., "throughput", "ap_health")
            timestamp: Unix timestamp (defaults to current generator time)
            entity: Optional AP entity for per-AP variation
            include_classifiers: If True, include classifier breakdown in result (FD-013)

        Returns:
            Observation dict with timestamp, metric, value, and optionally classifiers
        """
        if metric not in self.get_all_metrics():
            raise ValueError(f"Unknown metric: {metric}")

        ts = timestamp or (self.start_time + self.current_offset)
        entity_key = entity or "_global"

        # Ensure entity exists in state
        if entity_key not in self._client_load_state:
            self._init_entity_state(entity_key, ts)

        # Update classifiers and client_load at this timestamp
        self._update_state(entity_key, ts)

        # Derive metric value from daily profile + classifiers
        value = self._derive_metric(metric, entity_key, timestamp=ts)

        # Inject load patterns during business hours
        self._maybe_inject_load_patterns(ts)

        result = {
            "timestamp": ts,
            "metric": metric,
            "value": round(value, 2),
        }
        if entity is not None:
            result["entity"] = entity
        
        # Include classifier breakdown if requested (FD-013)
        if include_classifiers:
            result["classifiers"] = self._get_classifier_breakdown(metric, ts)

        return result

    def _load_classifier_thresholds(self) -> None:
        """
        Load classifier thresholds from baselines.json.
        
        Thresholds are derived from bootstrap percentiles and stored per hour-of-day.
        If baselines don't exist, thresholds remain empty and status will default to
        a fallback computation.
        """
        baselines_path = Path("data/baselines.json")
        if not baselines_path.exists():
            return
        
        try:
            with open(baselines_path) as f:
                baselines = json.load(f)
            
            classifiers = baselines.get("classifiers", {})
            for classifier_name, hourly_data in classifiers.items():
                self._classifier_thresholds[classifier_name] = {}
                
                for hour_entry in hourly_data:
                    hour = hour_entry["hour"]
                    thresholds = hour_entry.get("thresholds", {})
                    
                    if thresholds:
                        self._classifier_thresholds[classifier_name][hour] = {
                            "green_min": thresholds["green_min"],
                            "yellow_min": thresholds["yellow_min"],
                        }
        except (json.JSONDecodeError, KeyError, IOError):
            # If baselines are malformed or missing, continue without thresholds
            pass
    
    def _get_classifier_breakdown(self, metric: str, timestamp: int) -> list[dict]:
        """
        Get classifier breakdown for a metric (FD-013).
        
        Returns list of classifier status objects with name, value, status, contribution, weight.
        
        Args:
            metric: Metric name
            timestamp: Current timestamp
            
        Returns:
            List of classifier dicts with name, value, status, contribution, weight
        """
        metric_classifiers = METRIC_CLASSIFIERS.get(metric, {})
        classifiers = []
        
        for classifier_name, weight in metric_classifiers.items():
            classifier_cfg = CLASSIFIER_DEFINITIONS[classifier_name]
            current_value = self._classifier_state[classifier_name]
            
            # Compute status based on thresholds
            status = self._compute_classifier_status(classifier_name, current_value, timestamp)
            
            # Compute contribution (deviation from normal, weighted)
            normal_level = classifier_cfg["initial_level"]
            deviation = current_value - normal_level
            contribution = weight * deviation
            
            classifiers.append({
                "name": classifier_name,
                "value": round(current_value, 4),
                "status": status,
                "contribution": round(contribution, 4),
                "weight": round(weight, 4)
            })
        
        return classifiers

    def _compute_classifier_status(
        self, classifier_name: str, value: float, timestamp: int
    ) -> str:
        """
        Compute classifier status (green/yellow/red) based on bootstrap-derived thresholds.
        
        Thresholds are hour-specific and derived from observed percentiles:
        - green: value >= p25 (normal, expected range)
        - yellow: p10 <= value < p25 (slightly degraded)
        - red: value < p10 (critical)
        
        Args:
            classifier_name: Name of classifier
            value: Current classifier value (0.0-1.0)
            timestamp: Current timestamp for hour-of-day lookup
            
        Returns:
            "green", "yellow", or "red"
        """
        # Get hour of day
        dt = datetime.fromtimestamp(timestamp, tz=timezone.utc)
        hour = dt.hour
        
        # Look up thresholds for this classifier and hour
        thresholds = self._classifier_thresholds.get(classifier_name, {}).get(hour)
        
        if thresholds is None:
            # Fallback: if no thresholds available, use simple heuristics
            # This should only happen before first bootstrap or if baselines are missing
            # Heuristics use p25/p10 sensitivity to match the bootstrap-derived policy
            if value >= 0.95:
                return "green"
            elif value >= 0.90:
                return "yellow"
            else:
                return "red"
        
        # Apply bootstrap-derived thresholds
        green_min = thresholds["green_min"]
        yellow_min = thresholds["yellow_min"]
        
        if value >= green_min:
            return "green"
        elif value >= yellow_min:
            return "yellow"
        else:
            return "red"

    def _init_entity_state(self, entity_key: str, timestamp: int) -> None:
        """Initialize classifier state (shared pool) and client_load for an entity."""
        entity = entity_key if entity_key != "_global" else None

        # Initialize shared classifier pool (only once for the first entity)
        if not self._classifier_state:
            for classifier_name, cfg in CLASSIFIER_DEFINITIONS.items():
                self._classifier_state[classifier_name] = cfg["initial_level"]

        # Initialize client_load for this entity
        self._client_load_state[entity_key] = self._client_load_mean(entity, timestamp)
        self._last_update_time[entity_key] = timestamp

    def _update_state(self, entity_key: str, timestamp: int) -> None:
        """
        Update shared classifier state and client_load using OU processes.

        The OU process produces smooth, mean-reverting curves:
        x(t+dt) = μ + (x(t) - μ) * exp(-θ*dt) + noise

        Classifiers are shared across all entities (one pool).
        client_load is per-entity (environmental condition).
        
        After OU update, perturbations are applied to classifiers.
        """
        last_t = self._last_update_time.get(entity_key, timestamp)
        dt = max(0, timestamp - last_t)
        entity = entity_key if entity_key != "_global" else None

        if dt > 0:
            # OU process update for each classifier (shared pool)
            for classifier_name, cfg in CLASSIFIER_DEFINITIONS.items():
                theta = cfg["theta"]
                sigma = cfg["sigma"]
                
                # Classifiers revert to their initial_level (normal state)
                mu = cfg["initial_level"]
                
                # Current state
                x = self._classifier_state[classifier_name]
                
                # Exact OU update
                decay = math.exp(-theta * dt)
                
                if theta > 0:
                    noise_var = (sigma ** 2) / (2 * theta) * (1 - math.exp(-2 * theta * dt))
                    noise_std = math.sqrt(max(0, noise_var))
                else:
                    noise_std = 0
                
                x_new = mu + (x - mu) * decay + noise_std * self._rng.normal()
                
                # Apply perturbations (additive effects from events)
                perturbation_effect = self.perturbation_manager.total_effect(
                    classifier_name, timestamp, entity
                )
                x_new += perturbation_effect
                
                self._classifier_state[classifier_name] = float(np.clip(x_new, 0.0, 1.0))
            
            # OU process update for client_load (per-entity environmental condition) 
            theta_load = CLIENT_LOAD_CONFIG["theta"]
            sigma_load = CLIENT_LOAD_CONFIG["sigma"]
            
            # Time-varying mean for client_load
            mu_load = self._client_load_mean(entity, timestamp)
            
            x_load = self._client_load_state[entity_key]
            decay_load = math.exp(-theta_load * dt)
            
            if theta_load > 0:
                noise_var_load = (sigma_load ** 2) / (2 * theta_load) * (1 - math.exp(-2 * theta_load * dt))
                noise_std_load = math.sqrt(max(0, noise_var_load))
            else:
                noise_std_load = 0
            
            x_load_new = mu_load + (x_load - mu_load) * decay_load + noise_std_load * self._rng.normal()
            self._client_load_state[entity_key] = float(np.clip(x_load_new, 0.0, 1.0))
            
            self._last_update_time[entity_key] = timestamp

    def _client_load_mean(self, entity: Optional[str], timestamp: int) -> float:
        """
        Compute the time-varying mean for client_load, adjusted for AP topology.

        The mean follows daily/weekly rhythms, shifted by per-AP characteristics.
        """
        dt = datetime.fromtimestamp(timestamp)
        hour = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
        weekday = dt.weekday()  # 0=Monday, 6=Sunday
        is_weekend = weekday >= 5  # Saturday=5, Sunday=6

        base_mean = self._client_load_daily(hour)

        # Weekend reduction
        if is_weekend:
            base_mean *= 0.4

        # Per-AP topology offset
        if entity and entity in self._topology:
            ap_baseline = self._topology[entity].get("load_baseline", 0.45)
            base_mean += (ap_baseline - 0.45)

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

    def _derive_metric(self, metric: str, entity_key: str = "_global",
                       timestamp: int = None) -> float:
        """
        Derive a metric value from:
          1. Per-metric daily profile (deterministic shape)
          2. Classifier deviations (weighted contributions)

        Formula:
        value = daily_profile(hour) + Σ(classifier_weight × classifier_deviation × metric_range)
        
        where classifier_deviation = classifier_value - classifier_normal_level
        """
        cfg = self.config[metric]
        metric_range = cfg["max"] - cfg["min"]

        # 1. Per-metric daily profile: deterministic baseline by hour
        ts = timestamp or (self.start_time + self.current_offset)
        dt = datetime.fromtimestamp(ts)
        hour = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
        profile_value = self._metric_daily_profile(metric, hour)

        # 2. Classifier-based deviation
        classifier_contribution = 0.0
        metric_classifiers = METRIC_CLASSIFIERS.get(metric, {})
        
        for classifier_name, weight in metric_classifiers.items():
            classifier_cfg = CLASSIFIER_DEFINITIONS[classifier_name]
            normal_level = classifier_cfg["initial_level"]
            current_value = self._classifier_state[classifier_name]
            
            # Deviation from normal (can be positive or negative)
            deviation = current_value - normal_level
            
            # Contribution to metric (scaled by weight and metric range)
            classifier_contribution += weight * deviation * metric_range

        value = profile_value + classifier_contribution
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
        because state is updated only once per (entity, timestamp).

        Args:
            timestamp: Unix timestamp
            entity: AP entity name

        Returns:
            Dict mapping metric name to rounded value
        """
        # Ensure entity exists in state
        if entity not in self._client_load_state:
            self._init_entity_state(entity, timestamp)

        # Update state once for this entity/timestamp
        self._update_state(entity, timestamp)

        # Derive all metrics from daily profile + classifiers
        result = {}
        for metric in self.get_all_metrics():
            result[metric] = round(self._derive_metric(metric, entity, timestamp=timestamp), 2)
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
    Reset generator for live streaming while preserving classifier state.

    After bootstrap, the generator has start_time from days ago.
    This resets to current time while keeping classifier state and perturbations
    so live data flows smoothly from historical data.
    """
    global _generator_instance
    if _generator_instance is not None:
        # Preserve state for continuity
        preserved_classifiers = dict(_generator_instance._classifier_state)
        preserved_client_load = {
            k: v for k, v in _generator_instance._client_load_state.items()
        }
        preserved_perturbations = _generator_instance.perturbation_manager

        new_start = start_time if start_time is not None else int(time.time())
        _generator_instance = RealisticMetricsGenerator(start_time=new_start)

        # Restore preserved state
        _generator_instance._classifier_state = preserved_classifiers
        _generator_instance._client_load_state = preserved_client_load
        _generator_instance.perturbation_manager = preserved_perturbations

        # Update last update times to new start time
        for entity_key in _generator_instance._client_load_state.keys():
            _generator_instance._last_update_time[entity_key] = new_start
