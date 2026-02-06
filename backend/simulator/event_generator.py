"""
Event generator with scheduling and metric correlation.

Generates discrete events (device restarts, config changes, AI actions) 
that correlate with metric changes.
"""
import time
import random
from typing import Dict, List, Optional, Callable
from datetime import datetime, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler


class EventGenerator:
    """Generate network events with realistic timing and correlation."""

    EVENT_TYPES = [
        "device_restart",
        "device_crash",
        "firmware_update",
        "config_change",
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
        self.scheduler = AsyncIOScheduler()
        self.event_callbacks: List[Callable] = []
        self._event_task = None  # Track the async event loop task
        
    def register_callback(self, callback: Callable[[Dict], None]) -> None:
        """
        Register a callback to be called when events are generated.
        
        Args:
            callback: Function that takes an event dict
        """
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
        metadata: Optional[Dict] = None
    ) -> Dict:
        """
        Generate a single event.
        
        Args:
            event_type: Type of event
            entity: Affected entity (random if None)
            severity: info|warning|critical (auto-determined if None)
            metadata: Additional event-specific data
            
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
        
        return event
    
    def _default_severity(self, event_type: str) -> Optional[str]:
        """Determine default severity for event type."""
        severity_map = {
            "device_restart": "warning",
            "device_crash": "critical",
            "firmware_update": "info",
            "config_change": None,  # routine, no severity
            "ai_action": "info",
        }
        return severity_map.get(event_type)
    
    def _generate_message(self, event_type: str, entity: str) -> str:
        """Generate human-readable message for event."""
        messages = {
            "device_restart": f"{entity} rebooted unexpectedly",
            "device_crash": f"{entity} crashed and restarted",
            "firmware_update": f"{entity} firmware updated successfully",
            "config_change": f"{entity} configuration changed",
            "ai_action": f"AI optimized {entity} channel settings",
        }
        return messages.get(event_type, f"{event_type} occurred on {entity}")
    
    def _generate_metadata(self, event_type: str) -> Dict:
        """Generate realistic metadata for event type."""
        if event_type == "device_restart":
            return {
                "previous_uptime": random.randint(3600, 604800),  # 1 hour to 1 week
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
        
        return {}
    
    def schedule_random_events(self, avg_interval_minutes: int = 5) -> None:
        """
        Schedule random events with randomized timing.

        Uses exponential distribution for natural event spacing -
        events are more likely to be clustered sometimes and sparse other times,
        which is more realistic than fixed intervals.

        Args:
            avg_interval_minutes: Average time between event checks (actual timing varies)
        """
        import asyncio

        async def event_loop():
            """Continuously generate events with random delays."""
            while True:
                # Exponential distribution for time between events
                # This creates natural clustering - sometimes events come quickly,
                # sometimes there are longer gaps
                delay_minutes = random.expovariate(1.0 / avg_interval_minutes)
                # Clamp to reasonable bounds (1 minute to 30 minutes)
                delay_minutes = max(1, min(30, delay_minutes))

                await asyncio.sleep(delay_minutes * 60)

                # Weighted probability by event type (some events are rarer)
                event_weights = {
                    "device_restart": 0.15,
                    "device_crash": 0.05,  # Rare
                    "firmware_update": 0.10,
                    "config_change": 0.35,  # Common
                    "ai_action": 0.35,  # Common
                }

                if random.random() < 0.4:  # 40% chance to actually emit
                    event_type = random.choices(
                        list(event_weights.keys()),
                        weights=list(event_weights.values())
                    )[0]
                    event = self.generate_event(event_type)
                    self._emit_event(event)

        # Start the event loop as a background task
        self._event_task = asyncio.create_task(event_loop())
    
    def start(self) -> None:
        """Start the event generator (no-op, events start in schedule_random_events)."""
        # Events are now generated via asyncio task created in schedule_random_events
        pass
    
    def stop(self) -> None:
        """Stop the event generator."""
        if self._event_task:
            self._event_task.cancel()
            self._event_task = None
        if self.scheduler.running:
            self.scheduler.shutdown()
    
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
        # Only trigger occasionally to avoid spam
        if random.random() > 0.2:  # 20% chance
            return None
        
        # Map metrics to likely events
        correlation_map = {
            "ap_health": ["device_restart", "device_crash"],
            "time_to_connect": ["config_change", "ai_action"],
            "throughput": ["config_change", "ai_action"],
            "capacity": ["ai_action"],
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
