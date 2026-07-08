"""Shared event catalog for simulator events and classifier impacts."""

from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple


SEVERITIES = ("info", "warning", "critical")
EVENT_GROUPS = (
    "connection_auth",
    "rf_capacity",
    "lifecycle",
    "config",
    "security",
    "ai",
)


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


@dataclass(frozen=True)
class MetadataContext:
    event_type: str
    entity: str
    rng: Any
    server_lookup: Callable[[str], Optional[Dict]]


@dataclass(frozen=True)
class EventDefinition:
    event_type: str
    label: str
    group: str
    severity_choices: Tuple[str, ...]
    default_severity: str
    message_template: str
    metadata_generator: Callable[[MetadataContext], Dict]
    classifier_perturbations_by_severity: Dict[str, Dict[str, float]]
    duration_seconds_by_severity: Dict[str, int]
    recovery_curve: str
    background_eligible: bool = True

    def normalize_severity(self, severity: Optional[str]) -> str:
        normalized = severity or self.default_severity
        if normalized not in self.severity_choices:
            raise ValueError(
                f"Invalid severity '{normalized}' for event type '{self.event_type}'"
            )
        return normalized

    def affected_classifiers(self, severity: Optional[str] = None) -> Dict[str, float]:
        normalized = self.normalize_severity(severity)
        return dict(self.classifier_perturbations_by_severity[normalized])

    def duration_seconds(self, severity: Optional[str] = None) -> int:
        normalized = self.normalize_severity(severity)
        return self.duration_seconds_by_severity[normalized]


def _scale_effects(effects: Dict[str, float], multiplier: float) -> Dict[str, float]:
    return {
        classifier: round(value * multiplier, 4)
        for classifier, value in effects.items()
    }


def _severity_effects(
    base_effects: Dict[str, float],
    *,
    default_severity: str,
    severities: Sequence[str],
) -> Dict[str, Dict[str, float]]:
    multipliers = {
        "info": 0.45,
        "warning": 0.70,
        "critical": 1.00,
    }
    default_multiplier = multipliers[default_severity]
    return {
        severity: _scale_effects(
            base_effects,
            multipliers[severity] / default_multiplier,
        )
        for severity in severities
    }


def _severity_durations(
    base_duration: int,
    *,
    default_severity: str,
    severities: Sequence[str],
) -> Dict[str, int]:
    multipliers = {
        "info": 0.65,
        "warning": 1.00,
        "critical": 1.35,
    }
    default_multiplier = multipliers[default_severity]
    return {
        severity: max(20, int(base_duration * multipliers[severity] / default_multiplier))
        for severity in severities
    }


def _empty_metadata(_context: MetadataContext) -> Dict:
    return {}


def _device_restart_metadata(context: MetadataContext) -> Dict:
    return {
        "previous_uptime": context.rng.randint(3600, 604800),
        "reason": context.rng.choice(["watchdog_timeout", "manual", "power_loss"]),
        "initiated_by": context.rng.choice(["system", "admin"]),
    }


def _device_crash_metadata(context: MetadataContext) -> Dict:
    return {
        "crash_reason": context.rng.choice(
            ["kernel_panic", "out_of_memory", "hardware_error"]
        ),
        "uptime_at_crash": context.rng.randint(86400, 604800),
        "last_error": "System error code 0x"
        + format(context.rng.randint(0, 0xFFFF), "04x"),
    }


def _firmware_update_metadata(context: MetadataContext) -> Dict:
    versions = ["2.3.5", "2.4.0", "2.4.1", "2.5.0"]
    from_ver = context.rng.choice(versions[:-1])
    to_ver = context.rng.choice(versions[1:])
    return {
        "from_version": from_ver,
        "to_version": to_ver,
        "update_method": context.rng.choice(["auto", "manual"]),
    }


def _config_change_metadata(context: MetadataContext) -> Dict:
    change_type = context.rng.choice(["channel_switch", "power_adjust", "policy_update"])
    return {
        "changed_by": context.rng.choice(["admin_user", "automation", "ai_agent"]),
        "change_type": change_type,
        "old_value": str(context.rng.randint(1, 11)),
        "new_value": str(context.rng.randint(1, 11)),
    }


def _channel_change_metadata(context: MetadataContext) -> Dict:
    old_channel = context.rng.choice([1, 6, 11, 36, 40, 44, 149, 153, 157])
    new_channel = context.rng.choice([1, 6, 11, 36, 40, 44, 149, 153, 157])
    return {
        "changed_by": context.rng.choice(["automation", "ai_agent", "admin_user"]),
        "change_type": "channel_switch",
        "old_value": str(old_channel),
        "new_value": str(new_channel),
    }


def _ai_action_metadata(context: MetadataContext) -> Dict:
    actions = [
        ("channel_optimization", "Detected interference, switched to clearer channel"),
        ("power_adjustment", "Optimized transmit power for better coverage"),
        ("client_balancing", "Redistributed clients across APs for better performance"),
    ]
    action_type, reasoning = context.rng.choice(actions)
    return {
        "action_type": action_type,
        "reasoning": reasoning,
        "confidence": round(context.rng.uniform(0.75, 0.95), 2),
        "expected_impact": context.rng.choice(
            ["+10% throughput", "+15% coverage", "-20ms latency"]
        ),
    }


def _interference_metadata(context: MetadataContext) -> Dict:
    return {
        "source": context.rng.choice(
            ["microwave_oven", "bluetooth_device", "neighboring_ap", "radar"]
        ),
        "affected_channel": context.rng.choice([1, 6, 11, 36, 40, 44, 149, 153, 157]),
        "severity_dbm": round(context.rng.uniform(-20, -5), 1),
        "estimated_duration_minutes": context.rng.randint(2, 15),
    }


def _high_density_metadata(context: MetadataContext) -> Dict:
    return {
        "estimated_clients": context.rng.randint(45, 140),
        "trigger": context.rng.choice(
            ["class_change", "meeting_start", "shift_change", "event_crowd"]
        ),
    }


def _rogue_ap_metadata(context: MetadataContext) -> Dict:
    return {
        "bssid": ":".join(f"{context.rng.randint(0, 255):02x}" for _ in range(6)),
        "ssid": context.rng.choice(["Free-WiFi", "Guest-Setup", "CorpNet", "Printer-AP"]),
        "channel": context.rng.choice([1, 6, 11, 36, 40, 44, 149, 153, 157]),
    }


def _heat_event_metadata(context: MetadataContext) -> Dict:
    return {
        "temperature_c": context.rng.randint(67, 85),
        "fan_status": context.rng.choice(["degraded", "failed", "blocked"]),
    }


def _failure_metadata(
    context: MetadataContext,
    *,
    contributor: str,
    sub_contributor: str,
    server_type: str,
    reason_pool: Sequence[Dict],
    min_reasons: int,
    max_reasons: int,
    max_count: int,
) -> Dict:
    num_reasons = context.rng.randint(min_reasons, max_reasons)
    selected = context.rng.sample(reason_pool, min(num_reasons, len(reason_pool)))
    metadata = {
        "contributor": contributor,
        "sub_contributor": sub_contributor,
        "failure_reasons": [
            dict(reason, count=context.rng.randint(1, max_count))
            for reason in selected
        ],
    }
    server = context.server_lookup(server_type)
    if server:
        metadata["server"] = server
    return metadata


def _dhcp_metadata(context: MetadataContext) -> Dict:
    return _failure_metadata(
        context,
        contributor="dhcp",
        sub_contributor="No DHCP response",
        server_type="dhcp",
        reason_pool=DHCP_FAILURE_REASONS,
        min_reasons=1,
        max_reasons=3,
        max_count=50,
    )


def _radius_metadata(context: MetadataContext) -> Dict:
    return _failure_metadata(
        context,
        contributor="radius",
        sub_contributor="Auth timeout",
        server_type="radius",
        reason_pool=AUTH_FAILURE_REASONS,
        min_reasons=1,
        max_reasons=3,
        max_count=30,
    )


def _dns_metadata(context: MetadataContext) -> Dict:
    return _failure_metadata(
        context,
        contributor="dns",
        sub_contributor="No DNS Response",
        server_type="dns",
        reason_pool=DNS_FAILURE_REASONS,
        min_reasons=1,
        max_reasons=2,
        max_count=40,
    )


def _definition(
    *,
    event_type: str,
    label: str,
    group: str,
    severities: Sequence[str],
    default_severity: str,
    message_template: str,
    metadata_generator: Callable[[MetadataContext], Dict],
    base_effects: Dict[str, float],
    base_duration: int,
    recovery_curve: str,
    background_eligible: bool = True,
) -> EventDefinition:
    return EventDefinition(
        event_type=event_type,
        label=label,
        group=group,
        severity_choices=tuple(severities),
        default_severity=default_severity,
        message_template=message_template,
        metadata_generator=metadata_generator,
        classifier_perturbations_by_severity=_severity_effects(
            base_effects,
            default_severity=default_severity,
            severities=severities,
        ),
        duration_seconds_by_severity=_severity_durations(
            base_duration,
            default_severity=default_severity,
            severities=severities,
        ),
        recovery_curve=recovery_curve,
        background_eligible=background_eligible,
    )


EVENT_CATALOG: Dict[str, EventDefinition] = {
    "device_restart": _definition(
        event_type="device_restart",
        label="Device Restart",
        group="lifecycle",
        severities=("warning", "critical"),
        default_severity="warning",
        message_template="{entity} rebooted unexpectedly",
        metadata_generator=_device_restart_metadata,
        base_effects={"uptime": -0.30, "cpu": -0.10},
        base_duration=60,
        recovery_curve="exponential",
    ),
    "device_crash": _definition(
        event_type="device_crash",
        label="Device Crash",
        group="lifecycle",
        severities=("critical",),
        default_severity="critical",
        message_template="{entity} crashed and restarted",
        metadata_generator=_device_crash_metadata,
        base_effects={"uptime": -0.50, "cpu": -0.20, "client_density": -0.10},
        base_duration=120,
        recovery_curve="exponential",
        background_eligible=False,
    ),
    "firmware_update": _definition(
        event_type="firmware_update",
        label="Firmware Update",
        group="lifecycle",
        severities=("info", "warning"),
        default_severity="info",
        message_template="{entity} firmware updated successfully",
        metadata_generator=_firmware_update_metadata,
        base_effects={"uptime": -0.15, "cpu": -0.08},
        base_duration=30,
        recovery_curve="exponential",
    ),
    "heat_event": _definition(
        event_type="heat_event",
        label="Thermal Stress",
        group="lifecycle",
        severities=("warning", "critical"),
        default_severity="critical",
        message_template="{entity} experiencing thermal stress",
        metadata_generator=_heat_event_metadata,
        base_effects={"temperature": -0.35, "cpu": -0.15},
        base_duration=240,
        recovery_curve="sudden_recovery",
    ),
    "dhcp_server_overload": _definition(
        event_type="dhcp_server_overload",
        label="DHCP Overload",
        group="connection_auth",
        severities=("warning", "critical"),
        default_severity="critical",
        message_template="DHCP server overload affecting {entity}",
        metadata_generator=_dhcp_metadata,
        base_effects={"dhcp": -0.35},
        base_duration=180,
        recovery_curve="exponential",
    ),
    "radius_timeout": _definition(
        event_type="radius_timeout",
        label="RADIUS Timeout",
        group="connection_auth",
        severities=("warning", "critical"),
        default_severity="critical",
        message_template="RADIUS authentication timeout at {entity}",
        metadata_generator=_radius_metadata,
        base_effects={"authorization": -0.30},
        base_duration=120,
        recovery_curve="exponential",
    ),
    "dns_resolution_failure": _definition(
        event_type="dns_resolution_failure",
        label="DNS Resolution Failure",
        group="connection_auth",
        severities=("warning", "critical"),
        default_severity="critical",
        message_template="DNS resolution failures near {entity}",
        metadata_generator=_dns_metadata,
        base_effects={"dns": -0.40},
        base_duration=150,
        recovery_curve="exponential",
    ),
    "interference_event": _definition(
        event_type="interference_event",
        label="RF Interference",
        group="rf_capacity",
        severities=("warning", "critical"),
        default_severity="warning",
        message_template="RF interference detected near {entity}",
        metadata_generator=_interference_metadata,
        base_effects={
            "cochannel_interference": -0.30,
            "cca_busy": -0.25,
            "retry_rate": -0.20,
            "signal_strength": -0.15,
        },
        base_duration=300,
        recovery_curve="sudden_recovery",
    ),
    "high_density_event": _definition(
        event_type="high_density_event",
        label="High Density",
        group="rf_capacity",
        severities=("warning", "critical"),
        default_severity="warning",
        message_template="High client density at {entity}",
        metadata_generator=_high_density_metadata,
        base_effects={"client_density": -0.25, "airtime_utilization": -0.20},
        base_duration=1800,
        recovery_curve="linear",
    ),
    "rogue_ap": _definition(
        event_type="rogue_ap",
        label="Rogue AP",
        group="security",
        severities=("warning", "critical"),
        default_severity="warning",
        message_template="Rogue AP detected near {entity}",
        metadata_generator=_rogue_ap_metadata,
        base_effects={"cell_overlap": -0.30, "retry_rate": -0.25},
        base_duration=600,
        recovery_curve="sudden_recovery",
    ),
    "config_change": _definition(
        event_type="config_change",
        label="Configuration Change",
        group="config",
        severities=("info", "warning"),
        default_severity="info",
        message_template="{entity} configuration changed",
        metadata_generator=_config_change_metadata,
        base_effects={"channel_width": -0.05},
        base_duration=20,
        recovery_curve="exponential",
    ),
    "channel_change": _definition(
        event_type="channel_change",
        label="Channel Change",
        group="config",
        severities=("info", "warning"),
        default_severity="info",
        message_template="{entity} channel configuration updated",
        metadata_generator=_channel_change_metadata,
        base_effects={"channel_width": -0.10, "rssi_tuning": -0.08},
        base_duration=40,
        recovery_curve="exponential",
    ),
    "ai_action": _definition(
        event_type="ai_action",
        label="AI Optimization",
        group="ai",
        severities=("info",),
        default_severity="info",
        message_template="AI optimized {entity} channel settings",
        metadata_generator=_ai_action_metadata,
        base_effects={"channel_width": 0.08, "client_density": -0.03},
        base_duration=60,
        recovery_curve="gradual_improvement",
    ),
}


EVENT_TYPE_ALIASES = {
    "interference": "interference_event",
}


DEFAULT_EVENT_PROFILES = {
    "enterprise": {
        "avg_interval_minutes": 7,
        "emit_probability": 0.28,
        "business_hours_multiplier": 1.35,
        "off_hours_multiplier": 0.25,
        "severity_weights": {"info": 0.55, "warning": 0.38, "critical": 0.07},
        "event_weights": {
            "config_change": 0.22,
            "ai_action": 0.22,
            "channel_change": 0.12,
            "firmware_update": 0.08,
            "device_restart": 0.05,
            "dhcp_server_overload": 0.06,
            "radius_timeout": 0.04,
            "dns_resolution_failure": 0.04,
            "interference_event": 0.10,
            "high_density_event": 0.05,
            "heat_event": 0.02,
        },
        "event_weight_windows": [
            {
                "label": "business_hours_ops",
                "start_hour": 8,
                "end_hour": 18,
                "event_multipliers": {
                    "config_change": 1.35,
                    "ai_action": 1.35,
                    "channel_change": 1.20,
                },
            }
        ],
    },
    "campus": {
        "avg_interval_minutes": 4,
        "emit_probability": 0.36,
        "business_hours_multiplier": 1.20,
        "off_hours_multiplier": 0.60,
        "severity_weights": {"info": 0.42, "warning": 0.48, "critical": 0.10},
        "event_weights": {
            "high_density_event": 0.22,
            "interference_event": 0.20,
            "rogue_ap": 0.06,
            "dhcp_server_overload": 0.07,
            "radius_timeout": 0.06,
            "dns_resolution_failure": 0.05,
            "config_change": 0.10,
            "ai_action": 0.08,
            "channel_change": 0.08,
            "firmware_update": 0.03,
            "device_restart": 0.03,
            "heat_event": 0.02,
        },
        "event_weight_windows": [
            {
                "label": "class_change",
                "start_hour": 7.75,
                "end_hour": 18.25,
                "event_multipliers": {
                    "high_density_event": 1.70,
                    "interference_event": 1.35,
                    "dhcp_server_overload": 1.25,
                    "radius_timeout": 1.20,
                },
            }
        ],
    },
    "hospital": {
        "avg_interval_minutes": 10,
        "emit_probability": 0.22,
        "business_hours_multiplier": 1.05,
        "off_hours_multiplier": 0.85,
        "severity_weights": {"info": 0.70, "warning": 0.27, "critical": 0.03},
        "event_weights": {
            "ai_action": 0.22,
            "config_change": 0.16,
            "channel_change": 0.12,
            "firmware_update": 0.10,
            "dns_resolution_failure": 0.08,
            "radius_timeout": 0.06,
            "dhcp_server_overload": 0.06,
            "interference_event": 0.06,
            "high_density_event": 0.05,
            "rogue_ap": 0.04,
            "heat_event": 0.03,
            "device_restart": 0.02,
        },
        "event_weight_windows": [],
    },
}


def normalize_event_type(event_type: str) -> str:
    return EVENT_TYPE_ALIASES.get(event_type, event_type)


def get_event_definition(event_type: str) -> Optional[EventDefinition]:
    return EVENT_CATALOG.get(normalize_event_type(event_type))


def get_event_types() -> List[str]:
    return list(EVENT_CATALOG.keys())


def background_event_types() -> List[str]:
    return [
        event_type
        for event_type, definition in EVENT_CATALOG.items()
        if definition.background_eligible
    ]


def get_perturbation_policy(event_type: str, severity: Optional[str] = None) -> Optional[Dict]:
    definition = get_event_definition(event_type)
    if definition is None:
        return None
    normalized_severity = definition.normalize_severity(severity)
    return {
        "affected_classifiers": definition.affected_classifiers(normalized_severity),
        "duration_seconds": definition.duration_seconds(normalized_severity),
        "decay_type": definition.recovery_curve,
    }


def get_affected_classifiers(event_type: str, severity: Optional[str] = None) -> List[str]:
    policy = get_perturbation_policy(event_type, severity)
    if policy is None:
        return []
    return sorted(policy["affected_classifiers"].keys())


def build_legacy_perturbation_templates() -> Dict[str, Dict]:
    return {
        event_type: get_perturbation_policy(event_type, definition.default_severity)
        for event_type, definition in EVENT_CATALOG.items()
    }


def build_event_message(event_type: str, entity: str) -> str:
    definition = get_event_definition(event_type)
    if definition is None:
        return f"{event_type} occurred on {entity}"
    return definition.message_template.format(entity=entity)


def build_event_metadata(
    event_type: str,
    entity: str,
    *,
    rng: Any,
    server_lookup: Callable[[str], Optional[Dict]],
) -> Dict:
    definition = get_event_definition(event_type)
    if definition is None:
        return {}
    context = MetadataContext(
        event_type=definition.event_type,
        entity=entity,
        rng=rng,
        server_lookup=server_lookup,
    )
    return definition.metadata_generator(context)


def _copy_profile(profile: Dict) -> Dict:
    copied = dict(profile)
    copied["event_weights"] = dict(profile.get("event_weights", {}))
    copied["severity_weights"] = dict(profile.get("severity_weights", {}))
    copied["event_weight_windows"] = [
        {
            **window,
            "event_multipliers": dict(window.get("event_multipliers", {})),
        }
        for window in profile.get("event_weight_windows", [])
    ]
    return copied


def load_event_profile(config: Dict) -> Dict:
    profile_config = config.get("event_profile", {})
    profile_name = profile_config.get("name", "enterprise")
    base_profile = _copy_profile(
        DEFAULT_EVENT_PROFILES.get(profile_name, DEFAULT_EVENT_PROFILES["enterprise"])
    )

    for key, value in profile_config.items():
        if key == "event_weights":
            base_profile["event_weights"].update(value)
        elif key == "severity_weights":
            base_profile["severity_weights"].update(value)
        elif key == "event_weight_windows":
            base_profile["event_weight_windows"] = [
                {
                    **window,
                    "event_multipliers": dict(window.get("event_multipliers", {})),
                }
                for window in value
            ]
        else:
            base_profile[key] = value

    base_profile["name"] = profile_name
    base_profile["event_weights"] = {
        normalize_event_type(event_type): weight
        for event_type, weight in base_profile["event_weights"].items()
        if normalize_event_type(event_type) in EVENT_CATALOG
        and EVENT_CATALOG[normalize_event_type(event_type)].background_eligible
        and weight > 0
    }
    return base_profile


def validate_catalog() -> List[str]:
    errors = []
    for event_type, definition in EVENT_CATALOG.items():
        if event_type != definition.event_type:
            errors.append(f"{event_type} definition key mismatch")
        if definition.group not in EVENT_GROUPS:
            errors.append(f"{event_type} has invalid group {definition.group}")
        if definition.default_severity not in definition.severity_choices:
            errors.append(f"{event_type} default severity is invalid")
        for severity in definition.severity_choices:
            if severity not in SEVERITIES:
                errors.append(f"{event_type} has invalid severity {severity}")
            if severity not in definition.classifier_perturbations_by_severity:
                errors.append(f"{event_type} missing perturbation for {severity}")
            if severity not in definition.duration_seconds_by_severity:
                errors.append(f"{event_type} missing duration for {severity}")
        if not definition.label:
            errors.append(f"{event_type} missing label")
    return errors


def catalog_items() -> Iterable[Tuple[str, EventDefinition]]:
    return EVENT_CATALOG.items()
