"""Deterministic calibration diagnostics for simulator output."""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence

import numpy as np

from server.aggregation import aggregate_metric_observations
from simulator.perturbations import (
    PERTURBATION_TEMPLATES,
    create_perturbation_from_event,
)
from simulator.realistic_generator import RealisticMetricsGenerator


PERCENTILE_KEYS = ("p1", "p5", "p10", "p25", "p50", "p75", "p90", "p95", "p99")
CALIBRATION_TARGETS = {
    "p5_p95": 0.10,
    "p1_p99": 0.02,
    "p5_p95_tolerance": 0.08,
    "p1_p99_tolerance": 0.05,
}


def _hour(timestamp: int) -> int:
    """Return UTC hour for percentile bucketing."""
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).hour


def _diagnostic_event(
    *,
    timestamp: int,
    event_type: str,
    entity: str,
    severity: Optional[str],
    event_source: str,
    message: str,
) -> Dict:
    template = PERTURBATION_TEMPLATES.get(event_type, {})
    affected = sorted(template.get("affected_classifiers", {}).keys())
    return {
        "timestamp": timestamp,
        "event_type": event_type,
        "severity": severity,
        "entity": entity,
        "message": message,
        "event_source": event_source,
        "affected_classifiers": affected,
        "metadata": {
            "diagnostic": True,
            "event_source": event_source,
            "affected_classifiers": affected,
        },
    }


def _scheduled_timestamp(start_time: int, duration_seconds: int, fraction: float) -> int:
    if duration_seconds <= 1:
        return start_time
    offset = int(duration_seconds * fraction)
    return start_time + max(1, min(duration_seconds - 1, offset))


def default_background_event_schedule(
    *,
    start_time: int,
    duration_seconds: int,
    ap_list: Sequence[str] = None,
) -> List[Dict]:
    """Return deterministic background events for calibration diagnostics."""
    ap_names = list(ap_list or RealisticMetricsGenerator.ENTITIES)
    if not ap_names:
        return []

    return [
        _diagnostic_event(
            timestamp=_scheduled_timestamp(start_time, duration_seconds, 0.22),
            event_type="config_change",
            entity=ap_names[0],
            severity=None,
            event_source="background",
            message=f"{ap_names[0]} diagnostic background config change",
        ),
        _diagnostic_event(
            timestamp=_scheduled_timestamp(start_time, duration_seconds, 0.48),
            event_type="interference_event",
            entity=ap_names[min(1, len(ap_names) - 1)],
            severity="warning",
            event_source="background",
            message="Diagnostic background RF interference",
        ),
        _diagnostic_event(
            timestamp=_scheduled_timestamp(start_time, duration_seconds, 0.72),
            event_type="ai_action",
            entity=ap_names[-1],
            severity="info",
            event_source="background",
            message="Diagnostic background AI optimization",
        ),
    ]


def default_scenario_event_schedule(
    *,
    start_time: int,
    duration_seconds: int,
    ap_list: Sequence[str] = None,
) -> List[Dict]:
    """Return deterministic scenario-like events for calibration diagnostics."""
    ap_names = list(ap_list or RealisticMetricsGenerator.ENTITIES)
    if not ap_names:
        return []

    return [
        _diagnostic_event(
            timestamp=_scheduled_timestamp(start_time, duration_seconds, 0.18),
            event_type="dhcp_server_overload",
            entity=ap_names[0],
            severity="critical",
            event_source="scenario",
            message="Diagnostic scenario DHCP overload",
        ),
        _diagnostic_event(
            timestamp=_scheduled_timestamp(start_time, duration_seconds, 0.38),
            event_type="high_density_event",
            entity=ap_names[min(1, len(ap_names) - 1)],
            severity="warning",
            event_source="scenario",
            message="Diagnostic scenario high-density surge",
        ),
        _diagnostic_event(
            timestamp=_scheduled_timestamp(start_time, duration_seconds, 0.62),
            event_type="rogue_ap",
            entity=ap_names[-1],
            severity="warning",
            event_source="scenario",
            message="Diagnostic scenario rogue AP",
        ),
    ]


def _copy_events(events: Sequence[Dict] = None) -> List[Dict]:
    copied = []
    for event in events or []:
        event_copy = dict(event)
        event_copy["metadata"] = dict(event.get("metadata") or {})
        copied.append(event_copy)
    return sorted(copied, key=lambda event: event["timestamp"])


def _register_due_events(
    generator: RealisticMetricsGenerator,
    scheduled_events: List[Dict],
    event_index: int,
    timestamp: int,
) -> int:
    while (
        event_index < len(scheduled_events)
        and scheduled_events[event_index]["timestamp"] <= timestamp
    ):
        perturbation = create_perturbation_from_event(scheduled_events[event_index])
        if perturbation is not None:
            generator.perturbation_manager.add(perturbation)
        event_index += 1
    return event_index


def generate_samples(
    *,
    start_time: int,
    duration_seconds: int,
    interval_seconds: int = 300,
    ap_list: Sequence[str] = None,
    config_path: str = "simulator/config.json",
    scheduled_events: Sequence[Dict] = None,
) -> Dict[str, List[Dict]]:
    """
    Generate aggregated metric observations from the canonical frame path.

    This intentionally avoids automatic load-pattern perturbations so the report
    can measure normal operating variation separately from scheduled events.
    """
    generator = RealisticMetricsGenerator(
        config_path=config_path,
        start_time=start_time,
    )
    ap_names = list(ap_list or RealisticMetricsGenerator.ENTITIES)
    metrics = generator.get_all_metrics()
    samples = {metric: [] for metric in metrics}
    events = _copy_events(scheduled_events)
    event_index = 0

    for offset in range(0, duration_seconds, interval_seconds):
        timestamp = start_time + offset
        event_index = _register_due_events(generator, events, event_index, timestamp)
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


def generate_clean_samples(
    *,
    start_time: int,
    duration_seconds: int,
    interval_seconds: int = 300,
    ap_list: Sequence[str] = None,
    config_path: str = "simulator/config.json",
) -> Dict[str, List[Dict]]:
    """Generate clean/no-event aggregated metric observations."""
    return generate_samples(
        start_time=start_time,
        duration_seconds=duration_seconds,
        interval_seconds=interval_seconds,
        ap_list=ap_list,
        config_path=config_path,
        scheduled_events=None,
    )


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
        "targets": dict(CALIBRATION_TARGETS),
        "baseline_sample_count": {
            metric: len(samples) for metric, samples in baseline_samples.items()
        },
        "measured_sample_count": {
            metric: len(samples) for metric, samples in measured_samples.items()
        },
        "outside_rates": outside_rates,
    }


def calibration_diagnostic_report(
    *,
    baseline_start: int,
    baseline_duration_seconds: int,
    measured_start: int,
    measured_duration_seconds: int,
    interval_seconds: int = 300,
    ap_list: Sequence[str] = None,
    config_path: str = "simulator/config.json",
    background_events: Sequence[Dict] = None,
    scenario_events: Sequence[Dict] = None,
) -> Dict:
    """Generate clean, background, and scenario-inclusive calibration diagnostics."""
    baseline_samples = generate_clean_samples(
        start_time=baseline_start,
        duration_seconds=baseline_duration_seconds,
        interval_seconds=interval_seconds,
        ap_list=ap_list,
        config_path=config_path,
    )
    baselines = compute_hourly_baselines(baseline_samples)

    mode_specs = {
        "clean": {
            "label": "clean/no-event generation",
            "scheduled_events": [],
        },
        "background": {
            "label": "background-event generation",
            "scheduled_events": _copy_events(
                background_events
                or default_background_event_schedule(
                    start_time=measured_start,
                    duration_seconds=measured_duration_seconds,
                    ap_list=ap_list,
                )
            ),
        },
        "scenario": {
            "label": "scenario/event-inclusive generation",
            "scheduled_events": _copy_events(
                scenario_events
                or default_scenario_event_schedule(
                    start_time=measured_start,
                    duration_seconds=measured_duration_seconds,
                    ap_list=ap_list,
                )
            ),
        },
    }

    modes = {}
    for mode_name, mode_spec in mode_specs.items():
        samples = generate_samples(
            start_time=measured_start,
            duration_seconds=measured_duration_seconds,
            interval_seconds=interval_seconds,
            ap_list=ap_list,
            config_path=config_path,
            scheduled_events=mode_spec["scheduled_events"],
        )
        modes[mode_name] = {
            "label": mode_spec["label"],
            "sample_count": {metric: len(values) for metric, values in samples.items()},
            "scheduled_events": mode_spec["scheduled_events"],
            "outside_rates": compute_outside_rates(samples, baselines),
        }

    return {
        "targets": dict(CALIBRATION_TARGETS),
        "baseline_sample_count": {
            metric: len(samples) for metric, samples in baseline_samples.items()
        },
        "modes": modes,
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
