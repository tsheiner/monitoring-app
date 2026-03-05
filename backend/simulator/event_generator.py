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
from datetime import datetime, timedelta
from pathlib import Path

from simulator.perturbations import create_perturbation_from_event


# --- Failure Reason Code Constants (Phase 1) ---
# Sourced from production assurance-mock-generators (successful-connects.ts)

DHCP_FAILURE_REASONS = [
    {"type": "Meraki reason", "code": 108, "reason": "Unresponsive"},
    {"type": "Meraki reason", "code": 109, "reason": "Timeout"},
    {"type": "Meraki reason", "code": 110, "reason": "Stuck"},
    {"type": "Meraki reason", "code": 112, "reason": "Nack"},
]

AUTH_FAILURE_REASONS = [
    {"type": "Meraki reason", "code": 102, "reason": "EAPoL handshake error"},
    {"type": "Meraki reason", "code": 103, "reason": "Invalid PSK"},
    {"type": "802.11 reason", "code": 15, "reason": "4-way handshake timeout"},
]

DNS_FAILURE_REASONS = [
    {"type": "Meraki reason", "code": 114, "reason": "No DNS Response"},
    {"type": "Meraki reason", "code": 115, "reason": "Timeout"},
]

ASSOC_FAILURE_REASONS = [
    {"type": "802.11 status", "code": 0, "reason": "Reserved"},
    {"type": "802.11 reason", "code": 1, "reason": "Unspecified failure"},
]


class EventGenerator:
    """Generate network events with realistic timing and metric perturbations."""

    EVENT_TYPES = [
        # Infrastructure health events
        "device_restart",
        "device_crash",
        "firmware_update",
        "heat_event",
        
        # Connection/auth events
        "dhcp_server_overload",
        "radius_timeout",
        "dns_resolution_failure",
        
        # RF and capacity events
        "interference_event",
        "high_density_event",
        "rogue_ap",
        
        # Configuration events
        "config_change",
        "channel_change",
        
        # AI optimization
        "ai_action",
    ]

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
        if event_type not in self.EVENT_TYPES:
            raise ValueError(f"Unknown event type: {event_type}")

        entity = entity or random.choice(self.ENTITIES)
        severity = severity or self._default_severity(event_type)
        message = self._generate_message(event_type, entity)
        metadata = metadata or self._generate_metadata(event_type)

        # Enrich metadata with device identity when entity is a known AP (Phase 2)
        device_identity = self._get_device_identity(entity)
        if device_identity:
            metadata = dict(metadata)
            metadata["device"] = device_identity

        event = {
            "timestamp": int(time.time()),
            "event_type": event_type,
            "severity": severity,
            "entity": entity,
            "message": message,
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
        severity_map = {
            # Infrastructure health
            "device_restart": "warning",
            "device_crash": "critical",
            "firmware_update": "info",
            "heat_event": "critical",
            
            # Connection/auth issues
            "dhcp_server_overload": "critical",
            "radius_timeout": "critical",
            "dns_resolution_failure": "critical",
            
            # RF and capacity
            "interference_event": "warning",
            "high_density_event": "warning",
            "rogue_ap": "warning",
            
            # Configuration
            "config_change": None,
            "channel_change": "info",
            
            # AI
            "ai_action": "info",
        }
        return severity_map.get(event_type)

    def _generate_message(self, event_type: str, entity: str) -> str:
        """Generate human-readable message for event."""
        messages = {
            # Infrastructure health
            "device_restart": f"{entity} rebooted unexpectedly",
            "device_crash": f"{entity} crashed and restarted",
            "firmware_update": f"{entity} firmware updated successfully",
            "heat_event": f"{entity} experiencing thermal stress",
            
            # Connection/auth issues
            "dhcp_server_overload": f"DHCP server overload affecting {entity}",
            "radius_timeout": f"RADIUS authentication timeout at {entity}",
            "dns_resolution_failure": f"DNS resolution failures near {entity}",
            
            # RF and capacity
            "interference_event": f"RF interference detected near {entity}",
            "high_density_event": f"High client density at {entity}",
            "rogue_ap": f"Rogue AP detected near {entity}",
            
            # Configuration
            "config_change": f"{entity} configuration changed",
            "channel_change": f"{entity} channel configuration updated",
            
            # AI
            "ai_action": f"AI optimized {entity} channel settings",
        }
        return messages.get(event_type, f"{event_type} occurred on {entity}")

    def _generate_metadata(self, event_type: str) -> Dict:
        """Generate realistic metadata for event type."""
        if event_type == "device_restart":
            return {
                "previous_uptime": random.randint(3600, 604800),
                "reason": random.choice(["watchdog_timeout", "manual", "power_loss"]),
                "initiated_by": random.choice(["system", "admin"])
            }
        elif event_type == "device_crash":
            return {
                "crash_reason": random.choice(["kernel_panic", "out_of_memory", "hardware_error"]),
                "uptime_at_crash": random.randint(86400, 604800),
                "last_error": "System error code 0x" + format(random.randint(0, 0xFFFF), '04x')
            }
        elif event_type == "firmware_update":
            versions = ["2.3.5", "2.4.0", "2.4.1", "2.5.0"]
            from_ver = random.choice(versions[:-1])
            to_ver = random.choice(versions[1:])
            return {
                "from_version": from_ver,
                "to_version": to_ver,
                "update_method": random.choice(["auto", "manual"])
            }
        elif event_type == "config_change":
            change_types = ["channel_switch", "power_adjust", "policy_update"]
            change_type = random.choice(change_types)
            return {
                "changed_by": random.choice(["admin_user", "automation", "ai_agent"]),
                "change_type": change_type,
                "old_value": str(random.randint(1, 11)),
                "new_value": str(random.randint(1, 11))
            }
        elif event_type == "ai_action":
            actions = [
                ("channel_optimization", "Detected interference, switched to clearer channel"),
                ("power_adjustment", "Optimized transmit power for better coverage"),
                ("client_balancing", "Redistributed clients across APs for better performance")
            ]
            action_type, reasoning = random.choice(actions)
            return {
                "action_type": action_type,
                "reasoning": reasoning,
                "confidence": round(random.uniform(0.75, 0.95), 2),
                "expected_impact": random.choice(["+10% throughput", "+15% coverage", "-20ms latency"])
            }
        elif event_type == "interference":
            return {
                "source": random.choice(["microwave_oven", "bluetooth_device", "neighboring_ap", "radar"]),
                "affected_channel": random.randint(1, 11),
                "severity_dbm": round(random.uniform(-20, -5), 1),
                "estimated_duration_minutes": random.randint(2, 15)
            }
        elif event_type == "dhcp_server_overload":
            # Phase 1: structured failure reason codes
            num_reasons = random.randint(1, 3)
            selected = random.sample(DHCP_FAILURE_REASONS, min(num_reasons, len(DHCP_FAILURE_REASONS)))
            failure_reasons = [dict(r, count=random.randint(1, 50)) for r in selected]
            metadata = {
                "contributor": "dhcp",
                "sub_contributor": "No DHCP response",
                "failure_reasons": failure_reasons,
            }
            # Phase 3: server reference
            server = self._get_server_reference("dhcp")
            if server:
                metadata["server"] = server
            return metadata
        elif event_type == "radius_timeout":
            num_reasons = random.randint(1, 3)
            selected = random.sample(AUTH_FAILURE_REASONS, min(num_reasons, len(AUTH_FAILURE_REASONS)))
            failure_reasons = [dict(r, count=random.randint(1, 30)) for r in selected]
            metadata = {
                "contributor": "radius",
                "sub_contributor": "Auth timeout",
                "failure_reasons": failure_reasons,
            }
            server = self._get_server_reference("radius")
            if server:
                metadata["server"] = server
            return metadata
        elif event_type == "dns_resolution_failure":
            num_reasons = random.randint(1, 2)
            selected = random.sample(DNS_FAILURE_REASONS, min(num_reasons, len(DNS_FAILURE_REASONS)))
            failure_reasons = [dict(r, count=random.randint(1, 40)) for r in selected]
            metadata = {
                "contributor": "dns",
                "sub_contributor": "No DNS Response",
                "failure_reasons": failure_reasons,
            }
            server = self._get_server_reference("dns")
            if server:
                metadata["server"] = server
            return metadata

        return {}

    def schedule_random_events(self, avg_interval_minutes: int = 5) -> None:
        """
        Schedule random events with randomized timing.

        Uses exponential distribution for natural event spacing.
        """
        import asyncio

        async def event_loop():
            while True:
                delay_minutes = random.expovariate(1.0 / avg_interval_minutes)
                delay_minutes = max(1, min(30, delay_minutes))

                await asyncio.sleep(delay_minutes * 60)

                # Weighted probability by event type
                event_weights = {
                    "device_restart": 0.12,
                    "device_crash": 0.04,
                    "firmware_update": 0.08,
                    "config_change": 0.30,
                    "ai_action": 0.30,
                    "interference": 0.16,
                }

                if random.random() < 0.4:
                    event_type = random.choices(
                        list(event_weights.keys()),
                        weights=list(event_weights.values())
                    )[0]
                    event = self.generate_event(event_type)
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
            "coverage": ["interference"],
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
