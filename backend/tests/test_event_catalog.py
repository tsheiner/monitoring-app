"""Tests for the shared event catalog and profile-aware scheduler."""

from collections import Counter
import random

from simulator.event_catalog import (
    EVENT_GROUPS,
    SEVERITIES,
    background_event_types,
    build_event_metadata,
    catalog_items,
    get_perturbation_policy,
    normalize_event_type,
    validate_catalog,
)
from simulator.event_generator import EventGenerator


def _server_lookup(server_type):
    return {"ip": "10.0.0.1", "type": server_type}


def test_background_catalog_entries_have_required_contract():
    assert validate_catalog() == []

    background_types = set(background_event_types())
    assert background_types

    for event_type, definition in catalog_items():
        assert definition.group in EVENT_GROUPS
        assert definition.default_severity in definition.severity_choices
        assert set(definition.severity_choices) <= set(SEVERITIES)

        if not definition.background_eligible:
            continue

        metadata = build_event_metadata(
            event_type,
            "AP-Floor1-01",
            rng=random.Random(42),
            server_lookup=_server_lookup,
        )
        policy = get_perturbation_policy(event_type, definition.default_severity)

        assert definition.label
        assert isinstance(metadata, dict)
        assert policy is not None
        assert policy["affected_classifiers"]
        assert policy["duration_seconds"] > 0
        assert policy["decay_type"]


def test_interference_alias_maps_to_catalog_event_type():
    generator = EventGenerator(config_path="simulator/config_enterprise.json")

    event = generator.generate_event(
        "interference",
        entity="AP-Floor1-01",
        register_perturbation=False,
    )

    assert normalize_event_type("interference") == "interference_event"
    assert event["event_type"] == "interference_event"
    assert "interference" not in EventGenerator.EVENT_TYPES


def test_background_events_include_source_group_and_affected_classifiers():
    generator = EventGenerator(config_path="simulator/config_enterprise.json")

    event = generator.generate_event(
        "dhcp_server_overload",
        entity="AP-Floor1-01",
        event_source="background",
        register_perturbation=False,
    )

    assert event["event_source"] == "background"
    assert event["event_group"] == "connection_auth"
    assert event["affected_classifiers"] == ["dhcp"]
    assert event["metadata"]["event_source"] == "background"
    assert event["metadata"]["affected_classifiers"] == ["dhcp"]


def test_background_event_attribution_survives_storage_roundtrip(
    isolated_events_store,
):
    generator = EventGenerator(config_path="simulator/config_enterprise.json")
    event = generator.generate_event(
        "dhcp_server_overload",
        entity="AP-Floor1-01",
        event_source="background",
        register_perturbation=False,
    )

    isolated_events_store.insert_event(event)
    stored = isolated_events_store.query_range(
        event["timestamp"] - 1,
        event["timestamp"] + 1,
    )[0]

    assert stored["event_source"] == "background"
    assert stored["event_group"] == "connection_auth"
    assert stored["affected_classifiers"] == ["dhcp"]


def test_profile_aware_scheduler_produces_distinct_event_mixes(fixed_timestamp):
    timestamp = fixed_timestamp + 36 * 60 * 60
    enterprise = EventGenerator(config_path="simulator/config_enterprise.json")
    campus = EventGenerator(config_path="simulator/config_campus.json")
    hospital = EventGenerator(config_path="simulator/config_hospital.json")

    def sample(generator):
        rng = random.Random(20260708)
        return Counter(
            generator.choose_background_event_type(timestamp=timestamp, rng=rng)
            for _ in range(500)
        )

    enterprise_counts = sample(enterprise)
    campus_counts = sample(campus)
    hospital_counts = sample(hospital)

    campus_density_rf = (
        campus_counts["high_density_event"] + campus_counts["interference_event"]
    )
    enterprise_density_rf = (
        enterprise_counts["high_density_event"] + enterprise_counts["interference_event"]
    )
    hospital_operational = (
        hospital_counts["ai_action"]
        + hospital_counts["config_change"]
        + hospital_counts["firmware_update"]
    )
    campus_operational = (
        campus_counts["ai_action"]
        + campus_counts["config_change"]
        + campus_counts["firmware_update"]
    )

    assert campus_density_rf > enterprise_density_rf
    assert hospital_operational > campus_operational


def test_profile_aware_scheduler_uses_conservative_hospital_severity(fixed_timestamp):
    timestamp = fixed_timestamp + 36 * 60 * 60
    campus = EventGenerator(config_path="simulator/config_campus.json")
    hospital = EventGenerator(config_path="simulator/config_hospital.json")

    def critical_count(generator):
        rng = random.Random(20260708)
        return sum(
            1
            for _ in range(500)
            if generator.choose_background_severity(
                "dhcp_server_overload",
                rng=rng,
            )
            == "critical"
        )

    assert critical_count(hospital) < critical_count(campus)
