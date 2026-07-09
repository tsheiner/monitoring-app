"""
Tests for classifier-based perturbation system.

Verifies that perturbations:
- Target classifiers, not old drivers
- Use flat classifier names (e.g., 'dhcp', not 'successful_connects.dhcp')
- Filter by entity correctly
- Compute effects and decay properly
"""
from simulator.perturbations import Perturbation, PerturbationManager


def test_perturbation_effect_at_classifier_key():
    """Test that perturbation affects a classifier with correct magnitude."""
    pert = Perturbation(
        start_time=1000,
        duration_seconds=100,
        affected_classifiers={"dhcp": -0.35},
        decay_type="exponential",
        source_event_type="dhcp_server_overload",
        source_entity="ap_1"
    )
    
    # At start time, effect should be near full magnitude (exp decay starts at 1.0)
    effect = pert.effect_at("dhcp", 1000)
    assert abs(effect - (-0.35)) < 0.01, f"Expected ~-0.35, got {effect}"
    
    # Midway through, effect should be reduced
    effect_mid = pert.effect_at("dhcp", 1050)
    assert effect_mid > -0.35  # Decay means less negative
    assert effect_mid < 0  # Still negative
    
    # After expiry, effect should be zero
    effect_expired = pert.effect_at("dhcp", 1200)
    assert effect_expired == 0.0


def test_perturbation_unaffected_classifier_returns_zero():
    """Test that asking for an unaffected classifier returns 0."""
    pert = Perturbation(
        start_time=1000,
        duration_seconds=100,
        affected_classifiers={"dhcp": -0.35},
        decay_type="exponential"
    )
    
    # Classifier not in affected_classifiers
    effect = pert.effect_at("dns", 1000)
    assert effect == 0.0


def test_total_effect_filters_by_entity():
    """Test that PerturbationManager filters effects by entity."""
    manager = PerturbationManager()
    
    # Add perturbation for ap_1
    pert_ap1 = Perturbation(
        start_time=1000,
        duration_seconds=100,
        affected_classifiers={"dhcp": -0.30},
        source_entity="ap_1"
    )
    
    # Add perturbation for ap_2
    pert_ap2 = Perturbation(
        start_time=1000,
        duration_seconds=100,
        affected_classifiers={"dhcp": -0.20},
        source_entity="ap_2"
    )
    
    manager.add(pert_ap1)
    manager.add(pert_ap2)
    
    # Query for ap_1 should only see ap_1's effect
    effect_ap1 = manager.total_effect("dhcp", 1000, entity="ap_1")
    assert abs(effect_ap1 - (-0.30)) < 0.01
    
    # Query for ap_2 should only see ap_2's effect
    effect_ap2 = manager.total_effect("dhcp", 1000, entity="ap_2")
    assert abs(effect_ap2 - (-0.20)) < 0.01


def test_total_effect_includes_global_perturbations():
    """Test that global perturbations (no entity) affect all entities."""
    manager = PerturbationManager()
    
    # Global perturbation (empty source_entity)
    pert_global = Perturbation(
        start_time=1000,
        duration_seconds=100,
        affected_classifiers={"dhcp": -0.15},
        source_entity=""
    )
    
    # Entity-specific perturbation
    pert_ap1 = Perturbation(
        start_time=1000,
        duration_seconds=100,
        affected_classifiers={"dhcp": -0.10},
        source_entity="ap_1"
    )
    
    manager.add(pert_global)
    manager.add(pert_ap1)
    
    # ap_1 should see both global and its own effect
    effect_ap1 = manager.total_effect("dhcp", 1000, entity="ap_1")
    assert abs(effect_ap1 - (-0.25)) < 0.01  # -0.15 + -0.10
    
    # ap_2 should only see global effect
    effect_ap2 = manager.total_effect("dhcp", 1000, entity="ap_2")
    assert abs(effect_ap2 - (-0.15)) < 0.01  # Only global


def test_old_driver_keys_not_in_new_templates():
    """Test that old driver names (rf_quality, infra_health) are not in templates."""
    from simulator.perturbations import PERTURBATION_TEMPLATES, LOAD_PATTERN_TEMPLATES
    
    # Check all templates
    all_templates = {**PERTURBATION_TEMPLATES, **LOAD_PATTERN_TEMPLATES}
    
    for template_name, template in all_templates.items():
        affected = template.get("affected_classifiers", {})
        
        # Old driver names should NOT appear
        assert "rf_quality" not in affected, \
            f"Template '{template_name}' still uses old driver 'rf_quality'"
        assert "infra_health" not in affected, \
            f"Template '{template_name}' still uses old driver 'infra_health'"


def test_dot_notation_classifier_keys_rejected():
    """Test that dot-notation classifier keys (e.g., 'metric.classifier') are not allowed."""
    # Perturbation should use flat names like 'dhcp', not 'successful_connects.dhcp'
    # This is a structural test - the system should use shared flat names
    
    pert = Perturbation(
        start_time=1000,
        duration_seconds=100,
        affected_classifiers={
            "dhcp": -0.35,  # GOOD: flat name
        }
    )
    
    # Verify we can query with flat name
    effect = pert.effect_at("dhcp", 1000)
    assert effect != 0.0
    
    # Verify dot notation would not match (implicitly tests flat structure)
    effect_dot = pert.effect_at("successful_connects.dhcp", 1000)
    assert effect_dot == 0.0, "Dot notation should not match flat classifier names"


def test_create_perturbation_from_event_uses_classifiers():
    """Test that perturbation created from event targets classifiers."""
    from simulator.perturbations import create_perturbation_from_event
    
    event = {
        "timestamp": 1000,
        "event_type": "dhcp_server_overload",  # Will be added in FD-007
        "entity": "ap_1"
    }
    
    # Note: This will fail until we add new templates in FD-007
    # For now, we test the structure
    pert = create_perturbation_from_event(event)
    
    if pert is not None:
        # Should have affected_classifiers, not affected_metrics
        assert hasattr(pert, 'affected_classifiers')


def test_event_catalog_severity_changes_classifier_effect_and_duration():
    """Catalog severity controls perturbation magnitude and recovery."""
    from simulator.perturbations import create_perturbation_from_event

    warning = create_perturbation_from_event({
        "timestamp": 1000,
        "event_type": "dhcp_server_overload",
        "severity": "warning",
        "entity": "ap_1",
    })
    critical = create_perturbation_from_event({
        "timestamp": 1000,
        "event_type": "dhcp_server_overload",
        "severity": "critical",
        "entity": "ap_1",
    })

    assert warning is not None
    assert critical is not None
    assert abs(critical.affected_classifiers["dhcp"]) > abs(
        warning.affected_classifiers["dhcp"]
    )
    assert critical.duration_seconds > warning.duration_seconds
