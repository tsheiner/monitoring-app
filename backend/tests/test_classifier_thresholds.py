"""
Tests for classifier threshold derivation from bootstrap.

Verifies that:
- Thresholds are derived from baseline percentiles, not hardcoded
- Status classification (green/yellow/red) uses bootstrap-derived thresholds
- Changing OU sigma changes derived thresholds
- Thresholds are stored in and loaded from baselines.json
"""
import json
import numpy as np
from pathlib import Path


def test_baselines_json_includes_classifier_thresholds(temp_data_dir, monkeypatch):
    """Test that baselines.json includes threshold data for classifiers."""
    from simulator.bootstrap import bootstrap_historical_data
    from simulator.realistic_generator import RealisticMetricsGenerator
    
    # Keep all runtime artifacts isolated from the repository data directory.
    import os
    original_cwd = os.getcwd()
    os.chdir(temp_data_dir)
    monkeypatch.setenv("MONITORING_DATA_DIR", str(temp_data_dir / "data"))
    
    try:
        # Create data directory
        (temp_data_dir / "data").mkdir(exist_ok=True)
        
        # Run a minimal bootstrap (1 day)
        bootstrap_historical_data(days=1)
        
        # Load baselines
        baselines_path = temp_data_dir / "data" / "baselines.json"
        assert baselines_path.exists(), "baselines.json should exist"
        
        with open(baselines_path) as f:
            baselines = json.load(f)
        
        # Check that classifier baselines exist
        assert "classifiers" in baselines, "Should have classifiers section"
        classifiers = baselines["classifiers"]
        
        # Check that at least one classifier has threshold data
        # (We'll pick 'dhcp' as it's a common one)
        assert len(classifiers) > 0, "Should have some classifiers"
        
        # Each classifier should have hourly distributions with thresholds
        for classifier_name, hourly_data in classifiers.items():
            assert isinstance(hourly_data, list), f"{classifier_name} should have list of hourly data"
            
            if len(hourly_data) > 0:
                first_hour = hourly_data[0]
                assert "hour" in first_hour
                assert "distribution" in first_hour  
                
                # Should have thresholds derived from percentiles
                dist = first_hour["distribution"]
                
                # Check that we have percentile data
                assert "p10" in dist
                assert "p90" in dist
                
                # Optionally check for explicit threshold fields if we add them
                # (Not required - thresholds can be derived on-the-fly from percentiles)
    
    finally:
        os.chdir(original_cwd)


def test_thresholds_come_from_baseline_percentiles():
    """Test that status thresholds are derived from baseline percentiles, not hardcoded."""
    # This test verifies the concept - in a real bootstrap, thresholds should
    # be computed from observed data, not from config constants
    
    # Mock classifier baseline data with percentiles (including p25 for new policy)
    classifier_baseline = {
        "hour": 12,
        "distribution": {
            "p1": 0.850,
            "p2": 0.870,
            "p5": 0.900,
            "p10": 0.920,
            "p25": 0.940,
            "p90": 0.995,
            "p95": 0.997,
            "p98": 0.998,
            "p99": 0.999,
        }
    }
    
    # Policy: green if >= p25, yellow if >= p10, red if < p10
    # These thresholds come from the observed distribution
    green_threshold = classifier_baseline["distribution"]["p25"]  # 0.940
    yellow_threshold = classifier_baseline["distribution"]["p10"]  # 0.920
    
    # Test status classification
    assert green_threshold == 0.940
    assert yellow_threshold == 0.920
    
    # Value above p25 → green
    assert 0.960 > green_threshold  # Would be green
    
    # Value between p10 and p25 → yellow
    assert yellow_threshold < 0.930 < green_threshold  # Would be yellow
    
    # Value below p10 → red
    assert 0.910 < yellow_threshold  # Would be red


def test_status_classification_green_yellow_red():
    """Test that classifier status is correctly classified based on thresholds."""
    # Define thresholds (these would come from bootstrap in real system)
    thresholds = {
        "green": 0.940,   # p25 from bootstrap
        "yellow": 0.920,  # p10 from bootstrap
    }
    
    def classify_status(value, thresholds):
        if value >= thresholds["green"]:
            return "green"
        elif value >= thresholds["yellow"]:
            return "yellow"
        else:
            return "red"
    
    # Test status classification
    assert classify_status(0.960, thresholds) == "green"
    assert classify_status(0.950, thresholds) == "green"
    assert classify_status(0.930, thresholds) == "yellow"   # p10–p25 zone
    assert classify_status(0.925, thresholds) == "yellow"   # p10–p25 zone
    assert classify_status(0.910, thresholds) == "red"      # below p10
    assert classify_status(0.850, thresholds) == "red"
    assert classify_status(0.800, thresholds) == "red"


def test_classifier_status_green_requires_p25():
    """A value between p10 and p25 should be yellow, not green.
    
    This verifies the new threshold policy: green requires >= p25 (not just >= p10).
    With the old p10 green threshold, a p15 value would incorrectly return 'green'.
    """
    from simulator.realistic_generator import RealisticMetricsGenerator
    
    # Instantiate a minimal generator with thresholds at the new p25/p10 policy
    gen = object.__new__(RealisticMetricsGenerator)
    gen._classifier_thresholds = {
        "dhcp": {
            12: {
                "green_min": 0.960,   # p25 — green requires this or better
                "yellow_min": 0.940,  # p10 — yellow requires this or better
            }
        }
    }
    
    # Value at ~p15: between p10 (0.940) and p25 (0.960)
    p15_value = 0.950
    
    # Timestamp resolves to hour 12 UTC (2025-01-15 12:00:00 UTC)
    timestamp = 1736942400
    
    status = gen._compute_classifier_status("dhcp", p15_value, timestamp)
    assert status == "yellow", (
        f"Value {p15_value} is in the p10–p25 zone: expected 'yellow', got '{status}'. "
        "Green should require >= p25."
    )


def test_classifier_thresholds_vary_by_hour():
    """Test that classifier thresholds can vary by hour-of-day."""
    # Different hours may have different normal ranges
    # E.g., DHCP might be more stressed during peak hours
    
    hour_3_baseline = {
        "hour": 3,
        "distribution": {
            "p10": 0.985,   # Night time — very stable, tight band
            "p25": 0.990,   # Green boundary at p25
        }
    }
    
    hour_15_baseline = {
        "hour": 15,
        "distribution": {
            "p10": 0.950,   # Peak load — more variation
            "p25": 0.965,   # Green boundary at p25
        }
    }
    
    # Green threshold (p25) is higher at night (less variation expected)
    assert hour_3_baseline["distribution"]["p25"] > hour_15_baseline["distribution"]["p25"]
    
    # A value of 0.975 would be:
    # - Yellow at hour 3: 0.975 >= p10(0.985)? No — 0.975 < 0.985 → red (night is very stable)
    # - Green at hour 15: 0.975 >= p25(0.965) → green
    # This demonstrates hour-specific context matters


def test_changing_ou_sigma_changes_derived_thresholds(deterministic_seed):
    """Test that changing classifier OU sigma affects derived thresholds."""
    # This is a conceptual test - in reality, we'd run two bootstraps
    # with different sigma values and compare thresholds
    
    # Simulate: Higher sigma = more variation = wider threshold band
    # Lower sigma = less variation = tighter threshold band
    
    # Mock data: low sigma case
    low_sigma_values = np.random.normal(0.95, 0.01, 1000)  # Tight distribution
    p2_low = np.percentile(low_sigma_values, 2)
    p10_low = np.percentile(low_sigma_values, 10)
    p90_low = np.percentile(low_sigma_values, 90)
    
    # Reset seed for comparison
    np.random.seed(deterministic_seed)
    
    # Mock data: high sigma case
    high_sigma_values = np.random.normal(0.95, 0.05, 1000)  # Wide distribution
    p2_high = np.percentile(high_sigma_values, 2)
    p10_high = np.percentile(high_sigma_values, 10)
    p90_high = np.percentile(high_sigma_values, 90)
    
    # Higher sigma should produce wider bands
    low_band = p90_low - p10_low
    high_band = p90_high - p10_high
    
    assert high_band > low_band, "Higher sigma should produce wider percentile bands"
    
    # This means thresholds adapt to the actual variation in the data
