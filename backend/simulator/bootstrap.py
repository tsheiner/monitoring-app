"""
Bootstrap historical data generation with high-resolution simulation.

Generates 30 days of clean historical data at 10-second resolution,
computes baseline distributions from that clean data, then aggregates
to tiered storage and retroactively applies perturbation events.

This mirrors how a real monitoring system works:
1. High-resolution data is collected continuously
2. Historical baselines are computed from clean operating data
3. Data is aggregated over time (minute -> hour -> day averages)
4. Anomalies (perturbation events) appear as deviations from baseline

Aggregation tiers (from most recent to oldest):
- Raw (10s):    Last 2 hours     -- full resolution
- 1-min:        2h to 3h ago     -- 6:1 compression
- 5-min:        3h to 6h ago     -- 30:1 compression
- 15-min:       6h to 18h ago    -- 90:1 compression
- 1-hour:       18h to 3.75d ago -- 360:1 compression
- 6-hour:       3.75d to 9.75d   -- 2160:1 compression
- 12-hour:      9.75d to 29.75d  -- 4320:1 compression
"""
import time
import random
import json
import os
import math
from typing import Dict, List, Tuple, Optional
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

import numpy as np

from simulator.realistic_generator import (
    get_generator,
    reset_for_live_streaming,
    RealisticMetricsGenerator,
    CLASSIFIER_DEFINITIONS,
)
from simulator.event_generator import get_event_generator
from simulator.perturbations import (
    create_perturbation_from_event,
    Perturbation,
    PERTURBATION_TEMPLATES,
)
from storage.metrics_store import get_metrics_store
from storage.events_store import get_events_store


# Tier definitions: age boundaries from "now" and bucket interval
# Listed newest-first for convenient age lookup
TIERS = [
    {"name": "raw",     "max_age": 7200,    "interval": 10},       # 0-2h
    {"name": "1-min",   "max_age": 10800,   "interval": 60},       # 2-3h
    {"name": "5-min",   "max_age": 21600,   "interval": 300},      # 3-6h
    {"name": "15-min",  "max_age": 64800,   "interval": 900},      # 6-18h
    {"name": "1-hour",  "max_age": 324000,  "interval": 3600},     # 18h-3.75d
    {"name": "6-hour",  "max_age": 842400,  "interval": 21600},    # 3.75d-9.75d
    {"name": "12-hour", "max_age": 2570400, "interval": 43200},    # 9.75d-29.75d
]

TOTAL_DURATION = TIERS[-1]["max_age"]  # ~29.75 days


def _get_tier_interval(age: int) -> int:
    """Get the storage interval for a given age (seconds from now)."""
    for tier in TIERS:
        if age <= tier["max_age"]:
            return tier["interval"]
    return TIERS[-1]["interval"]


def _get_ap_list() -> List[str]:
    """Get list of AP names from the active config."""
    profile = os.environ.get("NETWORK_PROFILE", "enterprise")
    config_file = f"simulator/config_{profile}.json"

    try:
        config_path = Path(config_file)
        if not config_path.exists():
            config_path = Path("simulator/config_enterprise.json")

        with open(config_path, "r") as f:
            config = json.load(f)

        ap_topology = config.get("ap_topology", {})
        ap_names = [k for k in ap_topology.keys() if k != "description"]
        return ap_names if ap_names else ["_global"]
    except Exception as e:
        print(f"  Warning: Could not load AP topology from config: {e}")
        return ["_global"]


def bootstrap_historical_data(days: int = None) -> Dict[str, int]:
    """
    Generate and store tiered historical data with pre-computed baselines.

    Phase 1: Generate 30 days of clean 10s data in memory (no perturbations)
    Phase 2: Compute hourly baseline distributions from clean data
    Phase 3: Generate perturbation events and apply to bucket data
    Phase 4: Write aggregated data to database

    Args:
        days: Ignored (kept for backwards compatibility)

    Returns:
        Dict with counts of generated data
    """
    now = int(time.time())
    start_time = now - TOTAL_DURATION

    print(f"\nBootstrapping historical data (high-resolution simulation)...")
    print(f"  Historical range: {time.ctime(start_time)} to {time.ctime(now)}")
    print(f"  Total duration: {TOTAL_DURATION:,}s ({TOTAL_DURATION / 86400:.1f} days)")
    print(f"  Generation resolution: 10 seconds")

    ap_list = _get_ap_list()
    print(f"  APs: {len(ap_list)} ({', '.join(ap_list)})")

    generator = get_generator(start_time=start_time)
    all_metrics = generator.get_all_metrics()

    n_timestamps = TOTAL_DURATION // 10
    print(f"  Timestamps: {n_timestamps:,} (x{len(ap_list)} APs x {len(all_metrics)} metrics)")

    # ================================================================
    # PHASE 1: Generate clean high-resolution data in memory
    # ================================================================
    print(f"\n  Phase 1: Generating {n_timestamps:,} clean observations per AP...")
    phase1_start = time.time()

    # Accumulators for baseline computation (sum across APs per timestamp)
    # metric_sums[metric][t_idx] = sum of values across all APs
    metric_sums = {m: np.zeros(n_timestamps) for m in all_metrics}
    
    # NEW: Track classifier values for baseline computation
    # classifier_sums[classifier][t_idx] = sum of classifier values
    all_classifiers = list(CLASSIFIER_DEFINITIONS.keys())
    classifier_sums = {c: np.zeros(n_timestamps) for c in all_classifiers}

    # Accumulator for tiered storage (bucket -> running sum and count)
    # Key: (metric, ap, bucket_start) -> {"sum": float, "count": int}
    bucket_accum = defaultdict(lambda: {"sum": 0.0, "count": 0})

    for ap_idx, ap in enumerate(ap_list):
        # Re-initialize entity state for clean generation from start
        generator._init_entity_state(ap, start_time)
        ap_start = time.time()

        for t_idx in range(n_timestamps):
            ts = start_time + t_idx * 10
            age = now - ts

            # Generate all metrics for this AP at this timestamp
            # Note: perturbation_manager is empty -> clean data
            values = generator.generate_all_metrics_at(ts, entity=ap)

            for metric, value in values.items():
                # Accumulate for baseline (will divide by n_aps later)
                metric_sums[metric][t_idx] += value

                # Accumulate into storage bucket
                interval = _get_tier_interval(age)
                bucket_start = (ts // interval) * interval
                key = (metric, ap, bucket_start)
                bucket_accum[key]["sum"] += value
                bucket_accum[key]["count"] += 1
            
            # NEW: Capture classifier values for baseline computation
            # Classifiers are shared (not per-AP), so we only need to sample once per timestamp
            if ap_idx == 0:
                for classifier_name in all_classifiers:
                    classifier_value = generator._classifier_state[classifier_name]
                    classifier_sums[classifier_name][t_idx] = classifier_value

        elapsed = time.time() - ap_start
        print(f"    {ap}: {n_timestamps:,} timestamps in {elapsed:.1f}s")

    phase1_elapsed = time.time() - phase1_start
    print(f"  Phase 1 complete in {phase1_elapsed:.1f}s")

    # ================================================================
    # PHASE 2: Compute baseline distributions from clean aggregated data
    # ================================================================
    print(f"\n  Phase 2: Computing hourly baseline distributions...")
    phase2_start = time.time()

    n_aps = len(ap_list)
    baselines = {}
    classifier_baselines = {}

    # Pre-compute hour-of-day for each timestamp
    hours_of_day = np.array([
        datetime.fromtimestamp(start_time + t * 10).hour
        for t in range(n_timestamps)
    ])

    # Compute metric baselines
    for metric in all_metrics:
        # Average across APs to get aggregated values
        aggregated = metric_sums[metric] / n_aps

        # Group by hour-of-day
        hourly_bins = defaultdict(list)
        for t_idx in range(n_timestamps):
            hourly_bins[hours_of_day[t_idx]].append(float(aggregated[t_idx]))

        # Compute percentiles for each hour
        hourly_distributions = []
        for hour in range(24):
            values = np.array(hourly_bins.get(hour, []))
            if len(values) < 5:
                continue

            hourly_distributions.append({
                "hour": hour,
                "distribution": {
                    "p1": float(np.percentile(values, 1)),
                    "p5": float(np.percentile(values, 5)),
                    "p10": float(np.percentile(values, 10)),
                    "p25": float(np.percentile(values, 25)),
                    "p50": float(np.percentile(values, 50)),
                    "p75": float(np.percentile(values, 75)),
                    "p90": float(np.percentile(values, 90)),
                    "p95": float(np.percentile(values, 95)),
                    "p99": float(np.percentile(values, 99)),
                    "mean": float(np.mean(values)),
                    "stddev": float(np.std(values)),
                },
                "sample_count": len(values),
                "fallback_source": "data",
            })

        baselines[metric] = hourly_distributions

        # Print a diagnostic sample for noon hour
        noon_dist = next((d for d in hourly_distributions if d["hour"] == 12), None)
        if noon_dist:
            p5 = noon_dist["distribution"]["p5"]
            p95 = noon_dist["distribution"]["p95"]
            sample_per_hour = noon_dist["sample_count"]
            print(f"    {metric}: 24h bins, ~{sample_per_hour} samples/hour, noon p5-p95: [{p5:.2f}..{p95:.2f}]")
        else:
            print(f"    {metric}: 24h bins computed")
    
    # NEW: Compute classifier baselines
    print(f"  Computing classifier baselines...")
    for classifier_name in all_classifiers:
        # Classifier values are already raw (not per-AP averages)
        classifier_values = classifier_sums[classifier_name]
        
        # Group by hour-of-day
        hourly_bins = defaultdict(list)
        for t_idx in range(n_timestamps):
            hourly_bins[hours_of_day[t_idx]].append(float(classifier_values[t_idx]))
        
        # Compute percentiles for each hour
        hourly_distributions = []
        for hour in range(24):
            values = np.array(hourly_bins.get(hour, []))
            if len(values) < 5:
                continue
            
            hourly_distributions.append({
                "hour": hour,
                "distribution": {
                    "p1": float(np.percentile(values, 1)),
                    "p2": float(np.percentile(values, 2)),
                    "p5": float(np.percentile(values, 5)),
                    "p10": float(np.percentile(values, 10)),
                    "p25": float(np.percentile(values, 25)),
                    "p50": float(np.percentile(values, 50)),
                    "p75": float(np.percentile(values, 75)),
                    "p90": float(np.percentile(values, 90)),
                    "p95": float(np.percentile(values, 95)),
                    "p98": float(np.percentile(values, 98)),
                    "p99": float(np.percentile(values, 99)),
                    "mean": float(np.mean(values)),
                    "stddev": float(np.std(values)),
                },
                "sample_count": len(values),
                "thresholds": {
                    # Threshold policy: green >= p10, yellow >= p2, red < p2
                    # These are derived from observed bootstrap data, ensuring
                    # that values the simulation regularly produces during healthy
                    # operation won't be incorrectly flagged as degraded
                    "green_min": float(np.percentile(values, 10)),  # p10
                    "yellow_min": float(np.percentile(values, 2)),   # p2
                }
            })
        
        classifier_baselines[classifier_name] = hourly_distributions
        
        # Print diagnostic sample
        noon_dist = next((d for d in hourly_distributions if d["hour"] == 12), None)
        if noon_dist:
            p10 = noon_dist["distribution"]["p10"]
            p90 = noon_dist["distribution"]["p90"]
            print(f"    {classifier_name}: noon p10-p90: [{p10:.3f}..{p90:.3f}]")

    # Save baselines to JSON file
    baselines_path = Path("data/baselines.json")
    baselines_path.parent.mkdir(parents=True, exist_ok=True)
    baselines_data = {
        "generated_at": now,
        "lookback_days": TOTAL_DURATION / 86400,
        "n_aps": n_aps,
        "ap_list": ap_list,
        "metrics": baselines,
        "classifiers": classifier_baselines,  # NEW: Include classifier baselines
    }
    with open(baselines_path, "w") as f:
        json.dump(baselines_data, f, indent=2)
    print(f"  Baselines saved to {baselines_path}")

    phase2_elapsed = time.time() - phase2_start
    print(f"  Phase 2 complete in {phase2_elapsed:.1f}s")

    # ================================================================
    # PHASE 3: Generate retroactive perturbation events
    # ================================================================
    # NOTE: Perturbation application to data is disabled in Phase 1 implementation.
    # This will be re-enabled in Phase 2 (Perturbation Retargeting) when
    # perturbations are retargeted to affect classifiers instead of drivers.
    print(f"\n  Phase 3: Generating retroactive events (perturbation effects disabled)...")
    phase3_start = time.time()

    event_weights = {
        "device_restart": 0.12,
        "device_crash": 0.04,
        "firmware_update": 0.08,
        "config_change": 0.30,
        "ai_action": 0.30,
        "interference": 0.16,
    }
    event_types = list(event_weights.keys())
    weights = list(event_weights.values())

    avg_interval_seconds = 3600  # ~1 event per hour
    events = []
    current_time = start_time

    while current_time < now:
        interval = random.expovariate(1.0 / avg_interval_seconds)
        interval = max(300, min(14400, interval))
        current_time += int(interval)

        if current_time >= now:
            break

        event_type = random.choices(event_types, weights=weights)[0]
        entity = random.choice(ap_list)
        event = {
            "timestamp": current_time,
            "event_type": event_type,
            "severity": _event_severity(event_type),
            "entity": entity,
            "message": f"{event_type} on {entity}",
            "metadata": {},
        }
        events.append(event)

    print(f"    Generated {len(events)} historical events")
    print(f"    NOTE: Perturbation effects not applied (will be enabled in Phase 2)")

    # Store events
    events_store = get_events_store()
    events_store.insert_batch(events)

    phase3_elapsed = time.time() - phase3_start
    print(f"  Phase 3 complete in {phase3_elapsed:.1f}s")

    # ================================================================
    # PHASE 4: Write aggregated data to database
    # ================================================================
    print(f"\n  Phase 4: Writing aggregated observations to database...")
    phase4_start = time.time()

    metrics_store = get_metrics_store()
    total_observations = 0
    observations_by_metric = defaultdict(int)

    # Convert bucket accumulators to observations
    batch = []
    for (metric, ap, bucket_start), acc in bucket_accum.items():
        if acc["count"] == 0:
            continue
        mean_value = acc["sum"] / acc["count"]
        batch.append({
            "timestamp": bucket_start,
            "metric": metric,
            "value": round(mean_value, 2),
            "entity": ap,
        })
        observations_by_metric[metric] += 1
        total_observations += 1

        # Insert in batches of 10,000 to avoid memory pressure
        if len(batch) >= 10000:
            metrics_store.insert_batch(batch)
            batch = []

    # Insert remaining
    if batch:
        metrics_store.insert_batch(batch)

    for metric in all_metrics:
        count = observations_by_metric[metric]
        print(f"    {metric}: {count} aggregated observations")

    # Clear perturbations so they don't affect live streaming
    generator.perturbation_manager.clear()

    phase4_elapsed = time.time() - phase4_start
    total_elapsed = time.time() - phase1_start
    print(f"  Phase 4 complete in {phase4_elapsed:.1f}s")
    print(f"\n  Bootstrap complete in {total_elapsed:.1f}s total")
    print(f"  Total stored: {total_observations} aggregated observations")
    print(f"  Events: {len(events)}")

    return {
        "observations": total_observations,
        "events": len(events),
        "metrics": len(all_metrics),
        "aps": len(ap_list),
        "duration_days": TOTAL_DURATION / 86400,
    }


def _event_severity(event_type: str) -> Optional[str]:
    """Default severity for event type."""
    return {
        "device_restart": "warning",
        "device_crash": "critical",
        "firmware_update": "info",
        "config_change": None,
        "ai_action": "info",
        "interference": "warning",
    }.get(event_type)


if __name__ == "__main__":
    stats = bootstrap_historical_data()
    print("\nBootstrap complete:")
    print(f"  {stats['metrics']} metrics")
    print(f"  {stats['observations']} observations")
    print(f"  {stats['events']} events")
