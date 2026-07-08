"""Tests for clean calibration diagnostics."""

from simulator.calibration import (
    assert_clean_calibration,
    calibration_diagnostic_report,
    clean_calibration_report,
    compute_outside_rates,
)


def test_compute_outside_rates_uses_time_matched_hourly_baseline():
    measured = {
        "throughput": [
            {"timestamp": 1769990400, "value": 50.0},
            {"timestamp": 1769994000, "value": 101.0},
            {"timestamp": 1769997600, "value": 20.0},
        ]
    }
    baselines = {
        "throughput": {
            0: {"p1": 10.0, "p5": 20.0, "p95": 100.0, "p99": 110.0},
            1: {"p1": 10.0, "p5": 20.0, "p95": 100.0, "p99": 110.0},
            2: {"p1": 10.0, "p5": 20.0, "p95": 100.0, "p99": 110.0},
        }
    }

    report = compute_outside_rates(measured, baselines)

    assert report["throughput"]["overall"]["count"] == 3
    assert report["throughput"]["overall"]["p5_p95"] == 1 / 3
    assert report["throughput"]["overall"]["p1_p99"] == 0


def test_clean_calibration_report_stays_within_recorded_tolerance(fixed_timestamp):
    report = clean_calibration_report(
        baseline_start=fixed_timestamp,
        baseline_duration_seconds=30 * 24 * 60 * 60,
        measured_start=fixed_timestamp + 30 * 24 * 60 * 60,
        measured_duration_seconds=7 * 24 * 60 * 60,
        interval_seconds=600,
        ap_list=["AP-Floor1-01", "AP-Floor2-01", "AP-Floor3-01"],
    )

    assert_clean_calibration(report)


def test_calibration_diagnostic_report_separates_event_modes(fixed_timestamp):
    report = calibration_diagnostic_report(
        baseline_start=fixed_timestamp,
        baseline_duration_seconds=24 * 60 * 60,
        measured_start=fixed_timestamp + 24 * 60 * 60,
        measured_duration_seconds=6 * 60 * 60,
        interval_seconds=900,
        ap_list=["AP-Floor1-01", "AP-Floor2-01"],
    )

    assert set(report["modes"]) == {"clean", "background", "scenario"}
    assert report["modes"]["clean"]["scheduled_events"] == []

    for mode_name in ["clean", "background", "scenario"]:
        mode = report["modes"][mode_name]
        outside_rates = mode["outside_rates"]
        assert "time_to_connect" in outside_rates
        assert "overall" in outside_rates["time_to_connect"]
        assert "by_hour" in outside_rates["time_to_connect"]
        assert outside_rates["time_to_connect"]["by_hour"]
        assert {"p5_p95", "p1_p99"} <= set(
            outside_rates["time_to_connect"]["overall"]
        )

    for mode_name, expected_source in [
        ("background", "background"),
        ("scenario", "scenario"),
    ]:
        for event in report["modes"][mode_name]["scheduled_events"]:
            assert event["event_source"] == expected_source
            assert event["metadata"]["event_source"] == expected_source
            assert event["affected_classifiers"]


def test_clean_no_event_diagnostic_mode_stays_within_recorded_tolerance(fixed_timestamp):
    report = calibration_diagnostic_report(
        baseline_start=fixed_timestamp,
        baseline_duration_seconds=30 * 24 * 60 * 60,
        measured_start=fixed_timestamp + 30 * 24 * 60 * 60,
        measured_duration_seconds=7 * 24 * 60 * 60,
        interval_seconds=600,
        ap_list=["AP-Floor1-01", "AP-Floor2-01", "AP-Floor3-01"],
    )

    assert_clean_calibration(
        {
            "targets": report["targets"],
            "outside_rates": report["modes"]["clean"]["outside_rates"],
        }
    )
