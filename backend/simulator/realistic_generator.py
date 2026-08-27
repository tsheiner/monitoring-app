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
from typing import Dict, List, Optional, Sequence
import numpy as np

from simulator.perturbations import PerturbationManager, create_load_perturbation
from simulator.baseline_artifact import get_baseline_path


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

    # RF sub-scores (Phase 4) — from infra-rf-health.ts production data
    # ccaBusyScore range 32-98 in production → normalized ~0.32-0.98
    "cca_busy": {
        "theta": 0.0006,
        "sigma": 0.0025,
        "initial_level": 0.72,
        "description": "Clear Channel Assessment busy fraction (inverse — lower CCA busy = healthier)"
    },
    # lowRssiClientsScore: step-function in production (0, 33, 50, 100)
    # Low theta: population characteristic, changes slowly
    "low_rssi_clients": {
        "theta": 0.0001,
        "sigma": 0.0008,
        "initial_level": 0.85,
        "description": "Low RSSI client fraction (inverse — fewer low-RSSI clients = healthier)"
    },

    # Client signal quality (Phase 5) — models aggregate client radio quality
    # ~20.8% of coverage failures attributed to client-side signal weakness
    # Very low theta: client population is stable within a day
    "client_signal_quality": {
        "theta": 0.00008,
        "sigma": 0.0006,
        "initial_level": 0.82,
        "description": "Aggregate quality of connected clients' radio hardware and positioning"
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
        # Phase 4: redistributed — added cca_busy (0.20)
        "client_density": 0.40,
        "cochannel_interference": 0.25,
        "nonwifi_interference": 0.15,
        "cca_busy": 0.20,
    },
    "throughput": {
        # Phase 4: redistributed — added cca_busy (0.15)
        "airtime_utilization": 0.35,
        "channel_width": 0.25,
        "retry_rate": 0.25,
        "cca_busy": 0.15,
    },
    "coverage": {
        # Phase 4 + 5: redistributed — added low_rssi_clients (0.15) and client_signal_quality (0.20)
        "signal_strength": 0.35,
        "ap_density": 0.20,
        "cell_overlap": 0.10,
        "low_rssi_clients": 0.15,
        "client_signal_quality": 0.20,
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


def get_classifier_target(classifier_name: str, client_load: float) -> float:
    """
    Get time-varying target for a classifier based on external forces.

    Causal Architecture: Classifiers respond to client_load (primary driver).
    Load-sensitive classifiers degrade under high load, others remain stable.

    Args:
        classifier_name: Name of the classifier
        client_load: Current client load (0.0-1.0)

    Returns:
        Target value for the classifier (0.0-1.0)
    """
    base_target = CLASSIFIER_DEFINITIONS[classifier_name]["initial_level"]

    # Load-sensitive classifiers (respond to client_load)
    # Threshold: only respond when load exceeds 0.3 (light baseline activity)

    if classifier_name == "dhcp":
        # DHCP server queue pressure under load
        return base_target - 0.15 * max(0, client_load - 0.3)

    elif classifier_name == "authorization":
        # RADIUS authentication slower when busy
        return base_target - 0.20 * max(0, client_load - 0.3)

    elif classifier_name == "client_density":
        # Direct measure of clients/cell (inverted: more clients = lower score)
        return base_target - 0.50 * client_load

    elif classifier_name == "airtime_utilization":
        # More contention with more traffic
        return base_target - 0.30 * max(0, client_load - 0.2)

    elif classifier_name == "cpu":
        # APs work harder processing more clients
        return base_target - 0.20 * max(0, client_load - 0.3)

    elif classifier_name == "memory":
        # Larger connection tables
        return base_target - 0.15 * max(0, client_load - 0.3)

    elif classifier_name == "retry_rate":
        # More retries due to contention
        return base_target - 0.15 * max(0, client_load - 0.2)

    elif classifier_name == "cca_busy":
        # Clear-channel assessment busy time increases with traffic
        return base_target - 0.25 * max(0, client_load - 0.2)

    elif classifier_name == "low_rssi_clients":
        # More clients at cell edges under high load
        return base_target - 0.10 * max(0, client_load - 0.3)

    # Load-insensitive classifiers: return fixed target
    # These respond to events, RF environment, or are physics-based
    return base_target


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

        # Classifier state for the global/default entity. Kept as a direct
        # mapping for compatibility with older diagnostics.
        self._classifier_state: Dict[str, float] = {}

        # Per-entity classifier state.
        # Key: entity_key, Value: classifier name -> current value 0.0-1.0.
        self._classifier_state_by_entity: Dict[str, Dict[str, float]] = {}
        
        # Classifier thresholds (loaded from baselines.json)
        # Key: classifier name, Value: Dict[hour]->Dict[green_min, yellow_min]
        self._classifier_thresholds: Dict[str, Dict[int, Dict[str, float]]] = {}
        
        # Client load state (environmental condition)
        # Key: entity_key, Value: float
        self._client_load_state: Dict[str, float] = {}
        
        # Last update times
        self._last_update_time: Dict[str, int] = {}

        # Per-entity RNGs make AP iteration order irrelevant.
        self._rng_by_entity: Dict[str, np.random.RandomState] = {}

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
        self, metric: str, timestamp: int = None, entity: str = None,
        include_classifiers: bool = False, include_device_identity: bool = False
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
        frame = self.generate_metric_frame(
            timestamp=timestamp,
            entity=entity,
            include_classifiers=include_classifiers,
            include_device_identity=include_device_identity,
            metrics=[metric],
        )
        return frame[0]

    def generate_metric_frame(
        self,
        timestamp: int = None,
        entity: str = None,
        include_classifiers: bool = False,
        include_device_identity: bool = False,
        metrics: Optional[Sequence[str]] = None,
    ) -> List[Dict]:
        """
        Generate a complete observation frame for one entity and timestamp.

        The frame advances simulator state once for the entity, then derives all
        requested metrics and classifier breakdowns from that same state
        snapshot. This keeps metric-loop order from changing generated values.
        """
        ts = timestamp or (self.start_time + self.current_offset)
        entity_key = entity or "_global"
        requested_metrics = (
            list(metrics) if metrics is not None else self.get_all_metrics()
        )

        unknown_metrics = [
            metric for metric in requested_metrics
            if metric not in self.get_all_metrics()
        ]
        if unknown_metrics:
            raise ValueError(f"Unknown metric: {unknown_metrics[0]}")

        # Ensure entity exists in state
        if entity_key not in self._client_load_state:
            self._init_entity_state(entity_key, ts)

        # Update classifiers and client_load at this timestamp once.
        self._update_state(entity_key, ts)

        observations = []
        for metric in requested_metrics:
            value = self._derive_metric(metric, entity_key, timestamp=ts)
            result = {
                "timestamp": ts,
                "metric": metric,
                "value": round(value, 2),
            }
            if entity is not None:
                result["entity"] = entity

            if include_classifiers:
                result["classifiers"] = self._get_classifier_breakdown(
                    metric, ts, entity_key=entity_key
                )

            # Include device identity if requested and entity is a known AP (Phase 2)
            if include_device_identity and entity and entity in self._topology:
                ap_info = self._topology[entity]
                if "serial" in ap_info:
                    result["device"] = {
                        "name": entity,
                        "serial": ap_info.get("serial", ""),
                        "mac": ap_info.get("mac", ""),
                        "model": ap_info.get("model", ""),
                    }

            observations.append(result)

        return observations

    def _load_classifier_thresholds(self) -> None:
        """
        Load classifier thresholds from baselines.json.
        
        Thresholds are derived from bootstrap percentiles and stored per hour-of-day.
        If baselines don't exist, thresholds remain empty and status will default to
        a fallback computation.
        """
        baselines_path = get_baseline_path()
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

    def reload_classifier_thresholds(self) -> None:
        """Reload classifier status thresholds after a baseline refresh."""

        self._classifier_thresholds.clear()
        self._load_classifier_thresholds()
    
    def _get_classifier_breakdown(
        self, metric: str, timestamp: int, entity_key: str = "_global"
    ) -> list[dict]:
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
        classifier_state = self._get_classifier_state(entity_key)
        
        for classifier_name, weight in metric_classifiers.items():
            classifier_cfg = CLASSIFIER_DEFINITIONS[classifier_name]
            current_value = classifier_state[classifier_name]
            
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
            # Fallback: if no bootstrap thresholds are available, derive green/yellow
            # relative to this classifier's normal level (initial_level).
            # This avoids falsely marking healthy classifiers red simply because
            # their designed normal range is below 0.95.
            normal_level = CLASSIFIER_DEFINITIONS.get(classifier_name, {}).get(
                "initial_level", 0.90
            )
            green_min = max(0.0, normal_level - 0.02)   # ≤ 2% below normal = green
            yellow_min = max(0.0, normal_level - 0.08)  # 2–8% below normal = yellow
            if value >= green_min:
                return "green"
            elif value >= yellow_min:
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

    def _initial_classifier_state(self) -> Dict[str, float]:
        """Create a fresh classifier state map."""
        return {
            classifier_name: cfg["initial_level"]
            for classifier_name, cfg in CLASSIFIER_DEFINITIONS.items()
        }

    def _seed_for_entity(self, entity_key: str) -> int:
        """Build a deterministic seed that does not depend on Python hash salt."""
        seed = abs(self.start_time) % (2**31)
        for char in entity_key:
            seed = (seed * 131 + ord(char)) % (2**31)
        return seed

    def _get_entity_rng(self, entity_key: str) -> np.random.RandomState:
        """Get the deterministic RNG for an entity."""
        if entity_key not in self._rng_by_entity:
            self._rng_by_entity[entity_key] = np.random.RandomState(
                self._seed_for_entity(entity_key)
            )
        return self._rng_by_entity[entity_key]

    def _get_classifier_state(self, entity_key: str) -> Dict[str, float]:
        """Get classifier state for an entity, initializing it if needed."""
        if entity_key not in self._classifier_state_by_entity:
            self._classifier_state_by_entity[entity_key] = self._initial_classifier_state()
        if entity_key == "_global":
            self._classifier_state = self._classifier_state_by_entity[entity_key]
        return self._classifier_state_by_entity[entity_key]

    def _init_entity_state(self, entity_key: str, timestamp: int) -> None:
        """Initialize classifier state and client_load for an entity."""
        entity = entity_key if entity_key != "_global" else None

        self._classifier_state_by_entity[entity_key] = self._initial_classifier_state()
        if entity_key == "_global":
            self._classifier_state = self._classifier_state_by_entity[entity_key]

        # Initialize client_load for this entity
        self._client_load_state[entity_key] = self._client_load_mean(entity, timestamp)
        self._last_update_time[entity_key] = timestamp
        self._rng_by_entity[entity_key] = np.random.RandomState(
            self._seed_for_entity(entity_key)
        )

    def _update_state(self, entity_key: str, timestamp: int) -> None:
        """
        Update shared classifier state and client_load using OU processes.

        Causal Architecture:
        - Classifiers mean-revert to time-varying targets based on client_load
        - Load-sensitive classifiers respond to current load
        - Load-insensitive classifiers maintain fixed targets

        The OU process produces smooth, mean-reverting curves:
        x(t+dt) = μ(t) + (x(t) - μ(t)) * exp(-θ*dt) + noise

        Classifiers are maintained per entity so AP iteration order cannot
        change another AP's metric values.
        client_load is per-entity (environmental condition).

        After OU update, perturbations are applied to classifiers.
        """
        last_t = self._last_update_time.get(entity_key, timestamp)
        dt = max(0, timestamp - last_t)
        entity = entity_key if entity_key != "_global" else None

        if dt > 0:
            # Get current client load for computing time-varying targets
            current_load = self._client_load_state[entity_key]
            classifier_state = self._get_classifier_state(entity_key)
            rng = self._get_entity_rng(entity_key)

            # OU process update for each classifier for this entity.
            for classifier_name, cfg in CLASSIFIER_DEFINITIONS.items():
                theta = cfg["theta"]
                sigma = cfg["sigma"]

                # Classifiers revert to time-varying target based on client_load
                mu = get_classifier_target(classifier_name, current_load)

                # Current state
                x = classifier_state[classifier_name]

                # Exact OU update
                decay = math.exp(-theta * dt)

                if theta > 0:
                    noise_var = (sigma ** 2) / (2 * theta) * (1 - math.exp(-2 * theta * dt))
                    noise_std = math.sqrt(max(0, noise_var))
                else:
                    noise_std = 0

                x_new = mu + (x - mu) * decay + noise_std * rng.normal()

                # Apply perturbations (additive effects from events)
                perturbation_effect = self.perturbation_manager.total_effect(
                    classifier_name, timestamp, entity
                )
                x_new += perturbation_effect

                classifier_state[classifier_name] = float(np.clip(x_new, 0.0, 1.0))
            
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
            
            x_load_new = mu_load + (x_load - mu_load) * decay_load + noise_std_load * rng.normal()
            self._client_load_state[entity_key] = float(np.clip(x_load_new, 0.0, 1.0))
            
            self._last_update_time[entity_key] = timestamp
            if entity_key == "_global":
                self._classifier_state = classifier_state

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

    def _derive_metric(self, metric: str, entity_key: str = "_global",
                       timestamp: int = None) -> float:
        """
        Derive a metric value purely from weighted classifier health.

        Causal Architecture (see docs/causal-architecture.md):
        - Metrics emerge from classifier state (no independent daily profile)
        - Time-of-day patterns come from classifiers responding to client_load
        - Alignment guaranteed: classifier p50 → metric p50

        Formula:
        weighted_health = Σ(weight × classifier_value)

        For "lower is better" metrics:
            metric = min + (1 - weighted_health) × (max - min)
        For "higher is better" metrics:
            metric = min + weighted_health × (max - min)
        """
        cfg = self.config[metric]
        metric_classifiers = METRIC_CLASSIFIERS.get(metric, {})
        classifier_state = self._get_classifier_state(entity_key)

        # Compute weighted health score (0.0 to 1.0)
        weighted_health = 0.0
        for classifier_name, weight in metric_classifiers.items():
            current_value = classifier_state[classifier_name]
            weighted_health += weight * current_value

        # Map health around the configured metric baseline. This keeps the
        # clean operating center aligned with config while preserving classifier
        # causality for deviations.
        LOWER_IS_BETTER = {"time_to_connect", "roaming"}
        metric_range = cfg["max"] - cfg["min"]
        nominal_health = self._nominal_metric_health(metric)

        if metric in LOWER_IS_BETTER:
            # Healthier classifiers -> lower metric value
            value = (
                cfg["baseline"]
                + (nominal_health - weighted_health) * metric_range
            )
        else:
            # Healthier classifiers -> higher metric value
            value = cfg["baseline"] + (weighted_health - nominal_health) * metric_range

        return float(np.clip(value, cfg["min"], cfg["max"]))

    def _nominal_metric_health(self, metric: str) -> float:
        """Compute nominal classifier health for baseline-centered metrics."""
        return sum(
            weight * CLASSIFIER_DEFINITIONS[classifier_name]["initial_level"]
            for classifier_name, weight in METRIC_CLASSIFIERS.get(metric, {}).items()
        )

    def _maybe_inject_load_patterns(self, timestamp: int) -> None:
        """Randomly inject load pattern perturbations during business hours."""
        if timestamp - self._last_load_check < 30:
            return
        self._last_load_check = timestamp

        dt = datetime.fromtimestamp(timestamp)
        hour = dt.hour + dt.minute / 60.0
        if not (8 <= hour <= 18):
            return

        # Meeting room surge: ~3 per 10-hour business day
        if self._rng.random() < 0.3 / 120:
            p = create_load_perturbation("meeting_room_surge", timestamp)
            if p:
                self.perturbation_manager.add(p)

        # Large download: ~1 per business day
        if self._rng.random() < 0.1 / 120:
            p = create_load_perturbation("large_download", timestamp)
            if p:
                self.perturbation_manager.add(p)

    def tick(self, interval_seconds: int = 30) -> None:
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
        frame = self.generate_metric_frame(timestamp=timestamp, entity=entity)
        return {obs["metric"]: obs["value"] for obs in frame}

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
        preserved_classifiers_by_entity = {
            entity: dict(classifiers)
            for entity, classifiers in _generator_instance._classifier_state_by_entity.items()
        }
        preserved_client_load = {
            k: v for k, v in _generator_instance._client_load_state.items()
        }
        preserved_rng_by_entity = {
            entity: rng.get_state()
            for entity, rng in _generator_instance._rng_by_entity.items()
        }
        preserved_perturbations = _generator_instance.perturbation_manager

        new_start = start_time if start_time is not None else int(time.time())
        _generator_instance = RealisticMetricsGenerator(start_time=new_start)

        # Restore preserved state
        _generator_instance._classifier_state = preserved_classifiers
        _generator_instance._classifier_state_by_entity = preserved_classifiers_by_entity
        if "_global" in _generator_instance._classifier_state_by_entity:
            _generator_instance._classifier_state = (
                _generator_instance._classifier_state_by_entity["_global"]
            )
        _generator_instance._client_load_state = preserved_client_load
        _generator_instance.perturbation_manager = preserved_perturbations
        for entity, state in preserved_rng_by_entity.items():
            rng = np.random.RandomState()
            rng.set_state(state)
            _generator_instance._rng_by_entity[entity] = rng

        # Update last update times to new start time
        for entity_key in _generator_instance._client_load_state.keys():
            _generator_instance._last_update_time[entity_key] = new_start
