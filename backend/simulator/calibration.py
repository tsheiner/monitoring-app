"""Deterministic calibration diagnostics for clean simulator output."""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Sequence

import numpy as np

from server.aggregation import aggregate_metric_observations
from simulator.realistic_generator import RealisticMetricsGenerator


PERCENTILE_KEYS = ("p1", "p5", "p10", "p25", "p50", "p75", "p90", "p95", "p99")


def _hour(timestamp: int) -> int:
    """Return UTC hour for percentile bucketing."""
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).hour


def generate_clean_samples(
    *,
    start_time: int,
    duration_seconds: int,
    interval_seconds: int = 300,
    ap_list: Sequence[str] = None,
    config_path: str = "simulator/config.json",
) -> Dict[str, List[Dict]]:
    """
    Generate clean aggregated metric observations from the canonical frame path.

    This intentionally avoids automatic load-pattern perturbations so the report
    measures normal operating variation separately from injected events.
    """
    generator = RealisticMetricsGenerator(
        config_path=config_path,
        start_time=start_time,
    )
    ap_names = list(ap_list or RealisticMetricsGenerator.ENTITIES)
    metrics = generator.get_all_metrics()
    samples = {metric: [] for metric in metrics}

    for offset in range(0, duration_seconds, interval_seconds):
        timestamp = start_time + offset
        observations_by_metric = {metric: [] for metric in metrics}
        for ap in ap_names:
            frame = generator.generate_metric_frame(timestamp=timestamp, entity=ap)
            for observation in frame:
                observations_by_metric[observation["metric"]].append(observation)

        for metric, observations in observations_by_metric.items():
            aggregated = aggregate_metric_observations(observations)
            if aggregated is not None:
                samples[metric].append(aggregated)

    return samples


def compute_hourly_baselines(
    samples_by_metric: Dict[str, List[Dict]],
) -> Dict[str, Dict[int, Dict]]:
    """Compute hourly percentile baselines from clean samples."""
    baselines = {}
    for metric, samples in samples_by_metric.items():
        hourly_values = defaultdict(list)
        for sample in samples:
            hourly_values[_hour(sample["timestamp"])].append(sample["value"])

        metric_baseline = {}
        for hour, values in hourly_values.items():
            value_array = np.array(values)
            metric_baseline[hour] = {
                key: float(np.percentile(value_array, int(key[1:])))
                for key in PERCENTILE_KEYS
            }
            metric_baseline[hour]["count"] = len(values)
        baselines[metric] = metric_baseline
    return baselines


def compute_outside_rates(
    measured_by_metric: Dict[str, List[Dict]],
    baselines: Dict[str, Dict[int, Dict]],
) -> Dict[str, Dict]:
    """Report clean outside rates for p5-p95 and p1-p99 envelopes."""
    report = {}
    for metric, samples in measured_by_metric.items():
        totals = {
            "count": 0,
            "outside_p5_p95": 0,
            "outside_p1_p99": 0,
        }
        by_hour = {}

        for sample in samples:
            hour = _hour(sample["timestamp"])
            distribution = baselines.get(metric, {}).get(hour)
            if not distribution:
                continue

            value = sample["value"]
            outside_p5_p95 = value < distribution["p5"] or value > distribution["p95"]
            outside_p1_p99 = value < distribution["p1"] or value > distribution["p99"]

            hour_totals = by_hour.setdefault(
                hour,
                {"count": 0, "outside_p5_p95": 0, "outside_p1_p99": 0},
            )
            for bucket in (totals, hour_totals):
                bucket["count"] += 1
                bucket["outside_p5_p95"] += int(outside_p5_p95)
                bucket["outside_p1_p99"] += int(outside_p1_p99)

        def rates(bucket: Dict) -> Dict:
            count = bucket["count"]
            if count == 0:
                return {"count": 0, "p5_p95": 0.0, "p1_p99": 0.0}
            return {
                "count": count,
                "p5_p95": bucket["outside_p5_p95"] / count,
                "p1_p99": bucket["outside_p1_p99"] / count,
            }

        report[metric] = {
            "overall": rates(totals),
            "by_hour": {hour: rates(bucket) for hour, bucket in sorted(by_hour.items())},
        }
    return report


def clean_calibration_report(
    *,
    baseline_start: int,
    baseline_duration_seconds: int,
    measured_start: int,
    measured_duration_seconds: int,
    interval_seconds: int = 300,
    ap_list: Sequence[str] = None,
    config_path: str = "simulator/config.json",
) -> Dict:
    """Generate a deterministic clean calibration report."""
    baseline_samples = generate_clean_samples(
        start_time=baseline_start,
        duration_seconds=baseline_duration_seconds,
        interval_seconds=interval_seconds,
        ap_list=ap_list,
        config_path=config_path,
    )
    measured_samples = generate_clean_samples(
        start_time=measured_start,
        duration_seconds=measured_duration_seconds,
        interval_seconds=interval_seconds,
        ap_list=ap_list,
        config_path=config_path,
    )
    baselines = compute_hourly_baselines(baseline_samples)
    outside_rates = compute_outside_rates(measured_samples, baselines)

    return {
        "targets": {
            "p5_p95": 0.10,
            "p1_p99": 0.02,
            "p5_p95_tolerance": 0.08,
            "p1_p99_tolerance": 0.05,
        },
        "baseline_sample_count": {
            metric: len(samples) for metric, samples in baseline_samples.items()
        },
        "measured_sample_count": {
            metric: len(samples) for metric, samples in measured_samples.items()
        },
        "outside_rates": outside_rates,
    }


def assert_clean_calibration(report: Dict) -> None:
    """Raise AssertionError if clean outside rates exceed recorded tolerances."""
    target_p5_p95 = report["targets"]["p5_p95"]
    target_p1_p99 = report["targets"]["p1_p99"]
    tolerance_p5_p95 = report["targets"]["p5_p95_tolerance"]
    tolerance_p1_p99 = report["targets"]["p1_p99_tolerance"]

    failures = []
    for metric, metric_report in report["outside_rates"].items():
        overall = metric_report["overall"]
        if abs(overall["p5_p95"] - target_p5_p95) > tolerance_p5_p95:
            failures.append(
                f"{metric} p5-p95 outside rate {overall['p5_p95']:.1%}"
            )
        if abs(overall["p1_p99"] - target_p1_p99) > tolerance_p1_p99:
            failures.append(
                f"{metric} p1-p99 outside rate {overall['p1_p99']:.1%}"
            )

    assert not failures, "Clean calibration outside rates drifted: " + ", ".join(failures)
