"""
Event generator with scheduling and metric correlation.

Generates discrete events (device restarts, config changes, AI actions)
that correlate with metric changes via the perturbation system.

Events are causally linked to metrics: when an event occurs, a corresponding
perturbation is created that affects the relevant metrics with realistic
spike/recovery curves.
"""
import time
import random
from typing import Dict, List, Optional, Callable
from datetime import datetime, timedelta

from simulator.perturbations import create_perturbation_from_event


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

    def __init__(self):
        """Initialize event generator."""
        self.event_callbacks: List[Callable] = []
        self._event_task = None
        self._metrics_generator = None  # Set via set_metrics_generator()

    def set_metrics_generator(self, generator) -> None:
        """
        Link this event generator to a metrics generator.

        When events are generated, perturbations will be registered
        with the metrics generator so events cause visible metric changes.
        """
        self._metrics_generator = generator

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
