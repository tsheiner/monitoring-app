"""
Tests for Phase 5: Client Signal Quality Classifier.

Verifies that:
- client_signal_quality classifier exists with correct parameters
- It contributes only to coverage metric
- It is independent from signal_strength (low cross-correlation)
- Coverage metric weights still sum to 1.0
- Coverage baseline is preserved
"""
import math
import pytest
from simulator.realistic_generator import CLASSIFIER_DEFINITIONS, METRIC_CLASSIFIERS


# ---------------------------------------------------------------------------
# TestClientSignalQualityClassifier
# ---------------------------------------------------------------------------

class TestClientSignalQualityClassifier:
    """Client-side signal quality classifier exists and behaves correctly."""

    def test_classifier_defined(self):
        assert "client_signal_quality" in CLASSIFIER_DEFINITIONS
        cfg = CLASSIFIER_DEFINITIONS["client_signal_quality"]
        assert 0.75 <= cfg["initial_level"] <= 0.95, (
            f"initial_level {cfg['initial_level']} should be in [0.75, 0.90]"
        )
        assert "description" in cfg
        # description should reference client radio quality
        desc = cfg["description"].lower()
        assert "client" in desc

    def test_contributes_to_coverage(self):
        assert "client_signal_quality" in METRIC_CLASSIFIERS["coverage"]
        assert METRIC_CLASSIFIERS["coverage"]["client_signal_quality"] > 0

    def test_does_not_contribute_to_non_coverage_metrics(self):
        for metric, classifiers in METRIC_CLASSIFIERS.items():
            if metric != "coverage":
                assert "client_signal_quality" not in classifiers, (
                    f"client_signal_quality should not be in {metric}"
                )

    def test_independent_from_signal_strength(self, seeded_generator, fixed_timestamp):
        """client_signal_quality and signal_strength should not be perfectly correlated."""
        ss_vals = []
        csq_vals = []
        ts = fixed_timestamp
        for i in range(100):
            obs = seeded_generator.generate_observation(
                "coverage", timestamp=ts + i * 30, entity="AP-Floor1-01",
                include_classifiers=True
            )
            cls_map = {c["name"]: c["value"] for c in obs["classifiers"]}
            if "signal_strength" in cls_map and "client_signal_quality" in cls_map:
                ss_vals.append(cls_map["signal_strength"])
                csq_vals.append(cls_map["client_signal_quality"])

        assert ss_vals and csq_vals, "Should have data for both classifiers"

        n = len(ss_vals)
        mean_ss = sum(ss_vals) / n
        mean_csq = sum(csq_vals) / n

        cov = sum((a - mean_ss) * (b - mean_csq) for a, b in zip(ss_vals, csq_vals)) / n
        std_ss = math.sqrt(sum((v - mean_ss) ** 2 for v in ss_vals) / n)
        std_csq = math.sqrt(sum((v - mean_csq) ** 2 for v in csq_vals) / n)

        if std_ss > 0 and std_csq > 0:
            corr = cov / (std_ss * std_csq)
            assert abs(corr) < 0.9, (
                f"signal_strength and client_signal_quality are too strongly correlated "
                f"(r={corr:.3f}); they should be independent OU processes"
            )

    def test_coverage_weights_sum_to_one(self):
        total = sum(METRIC_CLASSIFIERS["coverage"].values())
        assert math.isclose(total, 1.0, abs_tol=1e-9), (
            f"coverage weights sum to {total}, expected 1.0"
        )


# ---------------------------------------------------------------------------
# TestClientSignalQualityRegressions
# ---------------------------------------------------------------------------

class TestClientSignalQualityRegressions:
    """Coverage metric behavior preserved."""

    def test_coverage_baseline_unchanged(self, seeded_generator, fixed_timestamp):
        """Coverage mean should stay near -55 dBm baseline (within 10%)."""
        import json
        from pathlib import Path
        with open(Path("simulator/config.json")) as f:
            cfg = json.load(f)

        baseline = cfg["coverage"]["baseline"]  # -55
        metric_range = cfg["coverage"]["max"] - cfg["coverage"]["min"]

        values = []
        for i in range(100):
            obs = seeded_generator.generate_observation(
                "coverage", timestamp=fixed_timestamp + i * 60
            )
            values.append(obs["value"])

        mean = sum(values) / len(values)
        assert abs(mean - baseline) <= 0.10 * abs(metric_range), (
            f"Coverage mean {mean:.2f} too far from baseline {baseline}"
        )

    def test_coverage_daily_profile_shape_preserved(self, seeded_generator, fixed_timestamp):
        """Coverage is mostly flat daily — peak and trough should be close."""
        # fixed_timestamp is 2026-02-01 00:00:00 UTC (hour=0)
        # hour=14 peak business hours, hour=3 trough
        from datetime import datetime, timezone, timedelta
        dt = datetime.fromtimestamp(fixed_timestamp, tz=timezone.utc)
        # Align to hour=14 and hour=3
        base_day = dt.replace(hour=0, minute=0, second=0, microsecond=0)
        ts_peak = int((base_day + timedelta(hours=14)).timestamp())
        ts_trough = int((base_day + timedelta(hours=3)).timestamp())

        obs_peak = seeded_generator.generate_observation("coverage", timestamp=ts_peak)
        obs_trough = seeded_generator.generate_observation("coverage", timestamp=ts_trough)

        # Coverage is physics: mostly flat. Difference should be small (< 5 dBm).
        diff = abs(obs_peak["value"] - obs_trough["value"])
        assert diff < 5.0, (
            f"Coverage daily swing {diff:.2f} dBm is too large — should be nearly flat"
        )
