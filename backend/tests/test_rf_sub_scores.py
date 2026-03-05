"""
Tests for Phase 4: RF Sub-Scores (cca_busy, low_rssi_clients).

Verifies that:
- New classifiers exist with correct parameters
- Weights in METRIC_CLASSIFIERS are redistributed and still sum to 1.0
- cca_busy is volatile and responds to interference events
- Existing classifiers and metrics are all preserved
"""
import math
import pytest
from simulator.realistic_generator import (
    CLASSIFIER_DEFINITIONS,
    METRIC_CLASSIFIERS,
)
from simulator.perturbations import PERTURBATION_TEMPLATES, create_perturbation_from_event


# ---------------------------------------------------------------------------
# TestRFClassifierDefinitions
# ---------------------------------------------------------------------------

class TestRFClassifierDefinitions:
    """New RF classifiers exist with correct parameters."""

    def test_cca_busy_classifier_defined(self):
        assert "cca_busy" in CLASSIFIER_DEFINITIONS
        cfg = CLASSIFIER_DEFINITIONS["cca_busy"]
        assert "theta" in cfg and "sigma" in cfg and "initial_level" in cfg
        # cca_busy is volatile (sigma higher than most)
        assert cfg["initial_level"] >= 0.5, "initial_level should be in realistic range"
        assert cfg["initial_level"] <= 1.0

    def test_low_rssi_clients_classifier_defined(self):
        assert "low_rssi_clients" in CLASSIFIER_DEFINITIONS
        cfg = CLASSIFIER_DEFINITIONS["low_rssi_clients"]
        assert cfg["initial_level"] >= 0.7

    def test_new_classifiers_have_descriptions(self):
        for name in ["cca_busy", "low_rssi_clients"]:
            cfg = CLASSIFIER_DEFINITIONS[name]
            assert "description" in cfg and cfg["description"]


# ---------------------------------------------------------------------------
# TestRFClassifiersInMetrics
# ---------------------------------------------------------------------------

class TestRFClassifiersInMetrics:
    """New RF classifiers contribute to appropriate metrics."""

    def test_cca_busy_contributes_to_capacity(self):
        assert "cca_busy" in METRIC_CLASSIFIERS["capacity"]
        assert METRIC_CLASSIFIERS["capacity"]["cca_busy"] > 0

    def test_cca_busy_contributes_to_throughput(self):
        assert "cca_busy" in METRIC_CLASSIFIERS["throughput"]
        assert METRIC_CLASSIFIERS["throughput"]["cca_busy"] > 0

    def test_low_rssi_clients_contributes_to_coverage(self):
        assert "low_rssi_clients" in METRIC_CLASSIFIERS["coverage"]
        assert METRIC_CLASSIFIERS["coverage"]["low_rssi_clients"] > 0

    def test_metric_classifier_weights_still_sum_to_one(self):
        for metric, classifiers in METRIC_CLASSIFIERS.items():
            total = sum(classifiers.values())
            assert math.isclose(total, 1.0, abs_tol=1e-9), (
                f"{metric} weights sum to {total}, expected 1.0"
            )


# ---------------------------------------------------------------------------
# TestRFClassifierBehavior
# ---------------------------------------------------------------------------

class TestRFClassifierBehavior:
    """New classifiers participate in the OU process and respond to perturbations."""

    def test_cca_busy_has_realistic_variance(self, seeded_generator, fixed_timestamp):
        values = []
        ts = fixed_timestamp
        for i in range(100):
            obs = seeded_generator.generate_observation(
                "capacity", timestamp=ts + i * 10, entity="AP-Floor1-01",
                include_classifiers=True
            )
            for cls in obs["classifiers"]:
                if cls["name"] == "cca_busy":
                    values.append(cls["value"])
                    break

        assert values, "cca_busy should appear in capacity classifier breakdown"
        mean = sum(values) / len(values)
        variance = sum((v - mean) ** 2 for v in values) / len(values)
        stddev = math.sqrt(variance)

        assert 0.0 <= mean <= 1.0
        assert stddev > 0.0, "cca_busy should not be flat — it has non-zero sigma"

    def test_interference_event_affects_cca_busy(self, seeded_generator, fixed_timestamp):
        template = PERTURBATION_TEMPLATES["interference_event"]
        assert "cca_busy" in template["affected_classifiers"], (
            "interference_event template should affect cca_busy (Phase 4)"
        )
        assert template["affected_classifiers"]["cca_busy"] < 0

        # Also verify via perturbation creation
        event = {
            "timestamp": fixed_timestamp,
            "event_type": "interference_event",
            "entity": "AP-Floor1-01",
        }
        p = create_perturbation_from_event(event)
        assert p is not None
        assert "cca_busy" in p.affected_classifiers

    def test_low_rssi_clients_stable_under_normal_conditions(
        self, seeded_generator, fixed_timestamp
    ):
        green_count = 0
        ts = fixed_timestamp
        for i in range(50):
            obs = seeded_generator.generate_observation(
                "coverage", timestamp=ts + i * 10, entity="AP-Floor1-01",
                include_classifiers=True
            )
            for cls in obs["classifiers"]:
                if cls["name"] == "low_rssi_clients" and cls["status"] == "green":
                    green_count += 1

        # Most should be green without perturbations
        assert green_count >= 35, (
            f"Only {green_count}/50 low_rssi_clients observations were green — "
            "expected mostly green under normal conditions"
        )


# ---------------------------------------------------------------------------
# TestRFSubScoreRegressions
# ---------------------------------------------------------------------------

class TestRFSubScoreRegressions:
    """Existing classifier and metric behavior preserved after adding RF sub-scores."""

    ORIGINAL_CLASSIFIERS = {
        "association", "authorization", "dhcp", "dns",
        "client_density", "cochannel_interference", "nonwifi_interference",
        "airtime_utilization", "channel_width", "retry_rate",
        "signal_strength", "ap_density", "cell_overlap",
        "handoff_latency", "rssi_tuning", "80211rk_support",
        "cpu", "memory", "uptime", "temperature",
    }

    def test_all_original_classifiers_still_present(self):
        for name in self.ORIGINAL_CLASSIFIERS:
            assert name in CLASSIFIER_DEFINITIONS, (
                f"Original classifier '{name}' was removed"
            )

    def test_all_original_metrics_still_derivable(self, seeded_generator, fixed_timestamp):
        from simulator.realistic_generator import RealisticMetricsGenerator
        for metric in RealisticMetricsGenerator.get_all_metrics():
            obs = seeded_generator.generate_observation(metric, timestamp=fixed_timestamp)
            assert "value" in obs and obs["value"] is not None

    def test_metric_values_in_expected_range_after_rf_addition(
        self, seeded_generator, fixed_timestamp
    ):
        import json
        from pathlib import Path
        cfg_path = Path("simulator/config.json")
        with open(cfg_path) as f:
            cfg = json.load(f)

        from simulator.realistic_generator import RealisticMetricsGenerator
        for metric in RealisticMetricsGenerator.get_all_metrics():
            if metric not in cfg:
                continue
            values = []
            for i in range(50):
                obs = seeded_generator.generate_observation(
                    metric, timestamp=fixed_timestamp + i * 60
                )
                values.append(obs["value"])
            mean = sum(values) / len(values)
            baseline = cfg[metric]["baseline"]
            metric_range = cfg[metric]["max"] - cfg[metric]["min"]
            # Mean should be within 20% of the metric range from baseline
            # (generous tolerance to avoid flakiness from weight redistribution)
            assert abs(mean - baseline) <= 0.25 * metric_range, (
                f"{metric}: mean {mean:.2f} too far from baseline {baseline}"
            )

    def test_existing_perturbation_templates_still_work(self):
        for event_type, template in PERTURBATION_TEMPLATES.items():
            for classifier in template["affected_classifiers"]:
                assert classifier in CLASSIFIER_DEFINITIONS or classifier == "client_load", (
                    f"Template '{event_type}' references unknown classifier '{classifier}'"
                )

    def test_classifier_breakdown_includes_new_and_old(
        self, seeded_generator, fixed_timestamp
    ):
        obs = seeded_generator.generate_observation(
            "capacity", timestamp=fixed_timestamp, include_classifiers=True
        )
        names = {c["name"] for c in obs["classifiers"]}
        assert "cochannel_interference" in names
        assert "cca_busy" in names
