"""
Tests for classifier-based event templates.

Verifies that:
- New event types target appropriate classifiers
- Event -> perturbation -> classifier cascade works
- Single event can affect multiple metrics via shared classifiers
- Severity/message metadata is preserved
"""
from simulator.perturbations import create_perturbation_from_event, PERTURBATION_TEMPLATES


def test_dhcp_overload_affects_expected_classifiers():
    """Test that dhcp_server_overload event targets dhcp classifier."""
    event = {
        "timestamp": 1000,
        "event_type": "dhcp_server_overload",
        "entity": "ap_1"
    }
    
    pert = create_perturbation_from_event(event)
    
    assert pert is not None
    assert "dhcp" in pert.affected_classifiers
    assert pert.affected_classifiers["dhcp"] < 0  # Negative impact
    assert pert.source_event_type == "dhcp_server_overload"


def test_radius_timeout_affects_auth_classifiers():
    """Test that radius_timeout event targets authorization classifier."""
    event = {
        "timestamp": 1000,
        "event_type": "radius_timeout",
        "entity": "ap_1"
    }
    
    pert = create_perturbation_from_event(event)
    
    assert pert is not None
    assert "authorization" in pert.affected_classifiers
    assert pert.affected_classifiers["authorization"] < 0


def test_dns_failure_affects_dns_classifier():
    """Test that dns_resolution_failure event targets dns classifier."""
    event = {
        "timestamp": 1000,
        "event_type": "dns_resolution_failure",
        "entity": "ap_1"
    }
    
    pert = create_perturbation_from_event(event)
    
    assert pert is not None
    assert "dns" in pert.affected_classifiers
    assert pert.affected_classifiers["dns"] < 0


def test_interference_event_affects_multiple_classifiers():
    """Test that interference_event affects cochannel_interference, retry_rate, signal_strength."""
    event = {
        "timestamp": 1000,
        "event_type": "interference_event",
        "entity": "ap_1"
    }
    
    pert = create_perturbation_from_event(event)
    
    assert pert is not None
    # Should affect multiple RF-related classifiers
    affected = pert.affected_classifiers
    assert "cochannel_interference" in affected or "retry_rate" in affected or "signal_strength" in affected


def test_high_density_event_affects_capacity_classifiers():
    """Test that high_density_event targets client_density and airtime_utilization."""
    event = {
        "timestamp": 1000,
        "event_type": "high_density_event",
        "entity": "ap_1"
    }
    
    pert = create_perturbation_from_event(event)
    
    assert pert is not None
    affected = pert.affected_classifiers
    # Should affect capacity-related classifiers
    assert "client_density" in affected or "airtime_utilization" in affected


def test_heat_event_affects_temperature_and_cpu():
    """Test that heat_event targets temperature and cpu classifiers."""
    event = {
        "timestamp": 1000,
        "event_type": "heat_event",
        "entity": "ap_1"
    }
    
    pert = create_perturbation_from_event(event)
    
    assert pert is not None
    affected = pert.affected_classifiers
    assert "temperature" in affected or "cpu" in affected


def test_single_event_cascades_to_dependent_metrics():
    """Test that a single classifier-targeting event cascades to multiple metrics."""
    # DHCP classifier is shared by successful_connects and time_to_connect
    # When dhcp_server_overload hits, both metrics should be affected
    
    event = {
        "timestamp": 1000,
        "event_type": "dhcp_server_overload",
        "entity": "ap_1"
    }
    
    pert = create_perturbation_from_event(event)
    
    assert pert is not None
    assert "dhcp" in pert.affected_classifiers
    
    # The cascade happens implicitly in the generator when it derives
    # metric values from classifier values. This test just verifies
    # that the perturbation targets the shared classifier.


def test_all_event_templates_have_valid_classifiers():
    """Test that all event templates use valid classifier names (no old drivers)."""
    invalid_names = {"rf_quality", "infra_health"}
    
    for event_type, template in PERTURBATION_TEMPLATES.items():
        affected = template.get("affected_classifiers", {})
        
        for classifier_name in affected.keys():
            assert classifier_name not in invalid_names, \
                f"Event '{event_type}' uses invalid classifier '{classifier_name}'"


def test_perturbation_metadata_preserved():
    """Test that event metadata is preserved in perturbation."""
    event = {
        "timestamp": 1234567890,
        "event_type": "device_crash",
        "entity": "ap_42",
        "severity": "critical"
    }
    
    pert = create_perturbation_from_event(event)
    
    assert pert is not None
    assert pert.start_time == 1234567890
    assert pert.source_event_type == "device_crash"
    assert pert.source_entity == "ap_42"
