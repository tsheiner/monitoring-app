"""
Event generator with scheduling and metric correlation.

Generates discrete events (device restarts, config changes, AI actions)
that correlate with metric changes via the perturbation system.

Events are causally linked to metrics: when an event occurs, a corresponding
perturbation is created that affects the relevant metrics with realistic
spike/recovery curves.
"""
import json
import time
import random
from typing import Dict, List, Optional, Callable
from datetime import datetime
from pathlib import Path

from simulator.event_catalog import (
    ASSOC_FAILURE_REASONS,
    AUTH_FAILURE_REASONS,
    DHCP_FAILURE_REASONS,
    DNS_FAILURE_REASONS,
    build_event_message,
    build_event_metadata,
    get_affected_classifiers,
    get_event_definition,
    get_event_types,
    load_event_profile,
    normalize_event_type,
)
from simulator.perturbations import create_perturbation_from_event


class EventGenerator:
    """Generate network events with realistic timing and metric perturbations."""

    EVENT_TYPES = get_event_types()

    ENTITIES = [
        "AP-Floor1-01",
        "AP-Floor1-02",
        "AP-Floor2-01",
        "AP-Floor2-02",
        "AP-Floor3-01",
        "AP-Floor3-02",
    ]

    def __init__(self, config_path=None):
        """Initialize event generator."""
        self.event_callbacks: List[Callable] = []
        self._event_task = None
        self._metrics_generator = None  # Set via set_metrics_generator()
        self._config: Dict = {}
        self._event_profile = load_event_profile({})

        # Load AP topology (device identity) and server info from config (Phases 2 & 3)
        self._topology: Dict[str, Dict] = {}
        self._servers: Dict[str, List] = {}
        self._load_config(config_path)

    def _load_config(self, config_path=None) -> None:
        """
        Load AP topology and server info from config file.

        Handles missing file or missing sections gracefully so existing behavior
        is fully preserved when the config lacks new fields.
        """
        try:
            if config_path is None:
                from simulator.realistic_generator import get_config_path
                cp = get_config_path()
            else:
                cp = Path(config_path)
            with open(cp) as f:
                cfg = json.load(f)

            self._config = cfg
            self._event_profile = load_event_profile(cfg)

            # Extract AP identity fields from topology (Phase 2)
            for ap_name, ap_data in cfg.get("ap_topology", {}).items():
                if isinstance(ap_data, dict) and "serial" in ap_data:
                    self._topology[ap_name] = {
                        "model": ap_data.get("model", ""),
                        "serial": ap_data.get("serial", ""),
                        "mac": ap_data.get("mac", ""),
                        "bands": ap_data.get("bands", []),
                    }

            # Extract server info (Phase 3)
            self._servers = cfg.get("servers", {})

        except (IOError, KeyError, json.JSONDecodeError, ImportError):
            self._event_profile = load_event_profile({})
            pass  # Graceful fallback — no identity/server enrichment

    def set_metrics_generator(self, generator) -> None:
        """
        Link this event generator to a metrics generator.

        When events are generated, perturbations will be registered
        with the metrics generator so events cause visible metric changes.
        """
        self._metrics_generator = generator

    def _get_device_identity(self, entity: str) -> Optional[Dict]:
        """Return device identity dict for a known AP entity, or None (Phase 2)."""
        if entity in self._topology:
            return dict(self._topology[entity])
        return None

    def _get_server_reference(self, server_type: str) -> Optional[Dict]:
        """Return a random server reference for dhcp/dns/radius events (Phase 3)."""
        servers = self._servers.get(server_type, [])
        if servers:
            server = random.choice(servers)
            return {"ip": server["ip"], "type": server_type}
        return None

    def register_callback(self, callback: Callable[[Dict], None]) -> None:
        """Register a callback to be called when events are generated."""
        self.event_callbacks.append(callback)

    def _emit_event(self, event: Dict) -> None:
        """Emit event to all registered callbacks."""
        for callback in self.event_callbacks:
            callback(event)

    def generate_event(
        self,
        event_type: str,
        entity: Optional[str] = None,
        severity: Optional[str] = None,
        metadata: Optional[Dict] = None,
        event_source: str = "background",
        register_perturbation: bool = True
    ) -> Dict:
        """
        Generate a single event and optionally register its perturbation.

        Args:
            event_type: Type of event
            entity: Affected entity (random if None)
            severity: info|warning|critical (auto-determined if None)
            metadata: Additional event-specific data
            register_perturbation: If True, register perturbation with metrics generator

        Returns:
            Event dict
        """
        event_type = normalize_event_type(event_type)
        definition = get_event_definition(event_type)
        if definition is None:
            raise ValueError(f"Unknown event type: {event_type}")

        entity = entity or random.choice(self.ENTITIES)
        severity = definition.normalize_severity(severity)
        message = self._generate_message(event_type, entity)
        metadata = (
            dict(metadata)
            if metadata is not None
            else self._generate_metadata(event_type, entity)
        )
        affected_classifiers = get_affected_classifiers(event_type, severity)

        # Enrich metadata with device identity when entity is a known AP (Phase 2)
        device_identity = self._get_device_identity(entity)
        if device_identity:
            metadata = dict(metadata)
            metadata["device"] = device_identity

        metadata.setdefault("event_source", event_source)
        metadata.setdefault("event_group", definition.group)
        metadata.setdefault("affected_classifiers", affected_classifiers)

        event = {
            "timestamp": int(time.time()),
            "event_type": event_type,
            "severity": severity,
            "entity": entity,
            "message": message,
            "event_source": event_source,
            "event_group": definition.group,
            "affected_classifiers": affected_classifiers,
            "metadata": metadata
        }

        # Create perturbation for metric causality
        if register_perturbation and self._metrics_generator is not None:
            perturbation = create_perturbation_from_event(event)
            if perturbation is not None:
                self._metrics_generator.perturbation_manager.add(perturbation)

        return event

    def _default_severity(self, event_type: str) -> Optional[str]:
        """Determine default severity for event type."""
        definition = get_event_definition(event_type)
        return definition.default_severity if definition is not None else None

    def _generate_message(self, event_type: str, entity: str) -> str:
        """Generate human-readable message for event."""
        return build_event_message(event_type, entity)

    def _generate_metadata(self, event_type: str, entity: str = "") -> Dict:
        """Generate realistic metadata for event type."""
        return build_event_metadata(
            event_type,
            entity,
            rng=random,
            server_lookup=self._get_server_reference,
        )

    def _hour_in_window(self, hour: float, start_hour: float, end_hour: float) -> bool:
        if start_hour <= end_hour:
            return start_hour <= hour < end_hour
        return hour >= start_hour or hour < end_hour

    def _profile_activity_multiplier(self, timestamp: int) -> float:
        dt = datetime.fromtimestamp(timestamp)
        hour = dt.hour + dt.minute / 60.0
        business_hours = (
            self._config.get("time_patterns", {})
            .get("business_hours", {})
        )
        start_hour = float(business_hours.get("start", 8))
        end_hour = float(business_hours.get("end", 18))
        if self._hour_in_window(hour, start_hour, end_hour):
            return float(self._event_profile.get("business_hours_multiplier", 1.0))
        return float(self._event_profile.get("off_hours_multiplier", 1.0))

    def background_emit_probability(self, timestamp: Optional[int] = None) -> float:
        """Return profile-aware probability for emitting a background event."""
        ts = timestamp or int(time.time())
        probability = float(self._event_profile.get("emit_probability", 0.25))
        return min(1.0, probability * self._profile_activity_multiplier(ts))

    def background_avg_interval_minutes(self) -> float:
        """Return profile-aware average scheduler interval."""
        return float(self._event_profile.get("avg_interval_minutes", 5))

    def _event_weights_for_timestamp(self, timestamp: int) -> Dict[str, float]:
        weights = dict(self._event_profile.get("event_weights", {}))
        dt = datetime.fromtimestamp(timestamp)
        hour = dt.hour + dt.minute / 60.0

        for window in self._event_profile.get("event_weight_windows", []):
            if not self._hour_in_window(
                hour,
                float(window.get("start_hour", 0)),
                float(window.get("end_hour", 24)),
            ):
                continue
            for event_type, multiplier in window.get("event_multipliers", {}).items():
                canonical_type = normalize_event_type(event_type)
                if canonical_type in weights:
                    weights[canonical_type] *= float(multiplier)

        return {
            event_type: weight
            for event_type, weight in weights.items()
            if get_event_definition(event_type) is not None and weight > 0
        }

    def choose_background_event_type(
        self,
        timestamp: Optional[int] = None,
        rng=None,
    ) -> str:
        """Choose a profile-aware background event type."""
        ts = timestamp or int(time.time())
        chooser = rng or random
        weights = self._event_weights_for_timestamp(ts)
        event_types = list(weights.keys())
        if not event_types:
            raise ValueError("Event profile has no background-eligible event weights")
        return chooser.choices(event_types, weights=list(weights.values()))[0]

    def choose_background_severity(
        self,
        event_type: str,
        rng=None,
    ) -> str:
        """Choose a profile-aware severity valid for the event type."""
        definition = get_event_definition(event_type)
        if definition is None:
            raise ValueError(f"Unknown event type: {event_type}")

        chooser = rng or random
        severity_weights = self._event_profile.get("severity_weights", {})
        choices = list(definition.severity_choices)
        weights = [float(severity_weights.get(severity, 0.0)) for severity in choices]
        if not any(weights):
            return definition.default_severity
        return chooser.choices(choices, weights=weights)[0]

    def schedule_random_events(self, avg_interval_minutes: int = 5) -> None:
        """
        Schedule profile-aware background events with randomized timing.

        Uses exponential distribution for natural event spacing.
        """
        import asyncio

        async def event_loop():
            while True:
                profile_interval = (
                    avg_interval_minutes
                    if avg_interval_minutes != 5
                    else self.background_avg_interval_minutes()
                )
                delay_minutes = random.expovariate(1.0 / profile_interval)
                delay_minutes = max(1, min(30, delay_minutes))

                await asyncio.sleep(delay_minutes * 60)

                now = int(time.time())
                if random.random() < self.background_emit_probability(now):
                    event_type = self.choose_background_event_type(now)
                    severity = self.choose_background_severity(event_type)
                    event = self.generate_event(
                        event_type,
                        severity=severity,
                        event_source="background",
                    )
                    self._emit_event(event)

        self._event_task = asyncio.create_task(event_loop())

    def start(self) -> None:
        """Start the event generator (no-op, events start in schedule_random_events)."""
        pass

    def stop(self) -> None:
        """Stop the event generator."""
        if self._event_task:
            self._event_task.cancel()
            self._event_task = None

    def generate_correlated_event(
        self,
        metric: str,
        metric_value: float,
        threshold: float
    ) -> Optional[Dict]:
        """
        Generate an event correlated with a metric anomaly.

        Args:
            metric: Metric name that triggered
            metric_value: Current metric value
            threshold: Threshold that was crossed

        Returns:
            Event dict if correlation triggered, None otherwise
        """
        if random.random() > 0.2:
            return None

        correlation_map = {
            "ap_health": ["device_restart", "device_crash"],
            "time_to_connect": ["config_change", "ai_action"],
            "throughput": ["config_change", "ai_action"],
            "capacity": ["ai_action"],
            "coverage": ["interference_event"],
        }

        possible_events = correlation_map.get(metric, ["config_change"])
        event_type = random.choice(possible_events)

        return self.generate_event(event_type)


# Singleton instance
_generator_instance = None

def get_event_generator() -> EventGenerator:
    """Get or create the global event generator instance."""
    global _generator_instance
    if _generator_instance is None:
        _generator_instance = EventGenerator()
    return _generator_instance
