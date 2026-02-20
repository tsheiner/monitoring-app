"""
Smoke tests to verify basic module import capability.
Tests that the test harness is properly configured.
"""

def test_import_realistic_generator():
    """Test that realistic generator module can be imported."""
    from simulator import realistic_generator
    assert hasattr(realistic_generator, 'RealisticMetricsGenerator')


def test_import_api_models():
    """Test that API model modules can be imported."""
    from server import models
    assert hasattr(models, 'MetricObservation')


def test_import_perturbations():
    """Test that perturbations module can be imported."""
    from simulator import perturbations
    assert hasattr(perturbations, 'PerturbationManager')


def test_import_bootstrap():
    """Test that bootstrap module can be imported."""
    from simulator import bootstrap
    assert hasattr(bootstrap, 'bootstrap_historical_data')
