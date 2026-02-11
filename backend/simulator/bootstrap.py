"""
Bootstrap historical data generation with tiered aggregation strategy.

Generates initial historical data for all metrics and events using
a tiered resolution approach to minimize storage while maintaining detail
where it matters most (recent data).

Events generated during bootstrap create perturbations that affect
the metric values, establishing causal event-metric relationships
in the historical data.

Aggregation tiers:
- Raw (10s): Last 1 minute
- 1-min buckets: 1 min to 1 hour
- 5-min buckets: 1-4 hours
- 15-min buckets: 4-24 hours
- 1-hour buckets: 1-7 days
- 6-hour buckets: 7-30 days
- 12-hour buckets: 30-90 days
"""
import time
import random
from typing import Dict, List

from simulator.realistic_generator import get_generator, reset_for_live_streaming
from simulator.event_generator import get_event_generator
from simulator.perturbations import create_perturbation_from_event
from storage.metrics_store import get_metrics_store
from storage.events_store import get_events_store


def bootstrap_historical_data(days: int = None) -> Dict[str, int]:
    """
    Generate and store tiered historical data for all metrics and events.

    Events are generated first (or interleaved), and their perturbations
    are registered with the metrics generator so that metric values
    reflect the impact of events.

    Args:
        days: Ignored (kept for backwards compatibility). Actual duration
              is determined by tier configuration (~30 days).

    Returns:
        Dict with counts of generated data
    """
    print(f"\nBootstrapping tiered historical data...")
    print("Aggregation strategy:")
    print("  Raw (10s): Last 2 hours")
    print("  1-min: Last hour")
    print("  5-min: 3 hours")
    print("  15-min: 12 hours")
    print("  1-hour: 3 days")
    print("  6-hour: 6 days")
    print("  12-hour: 20 days")
    print("  Total: ~30 days\n")

    # Always end at current time for live prototype
    now = int(time.time())

    # Define time tiers in CHRONOLOGICAL order (oldest to newest)
    tiers = [
        {"name": "12-hour", "duration": 1728000, "interval": 43200},     # 20 days (40 intervals)
        {"name": "6-hour", "duration": 518400, "interval": 21600},       # 6 days (24 intervals)
        {"name": "1-hour", "duration": 259200, "interval": 3600},        # 3 days (72 intervals)
        {"name": "15-min", "duration": 43200, "interval": 900},          # 12 hours (48 intervals)
        {"name": "5-min", "duration": 10800, "interval": 300},           # 3 hours (36 intervals)
        {"name": "1-min", "duration": 3600, "interval": 60},             # 1 hour (60 intervals)
        {"name": "Raw (10s)", "duration": 7200, "interval": 10},         # 2 hours (720 intervals)
    ]

    total_duration = sum(t["duration"] for t in tiers)
    start_time = now - total_duration

    print(f"Historical data range: {time.ctime(start_time)} to {time.ctime(now)}")
    print(f"Total duration: {total_duration:,} seconds ({total_duration/86400:.1f} days)\n")

    # Initialize generators and storage
    metrics_generator = get_generator(start_time=start_time)
    event_generator = get_event_generator()
    event_generator.set_metrics_generator(metrics_generator)
    metrics_store = get_metrics_store()
    events_store = get_events_store()

    # --- Phase 1: Generate historical events with Poisson timing ---
    # We generate ALL events first so their perturbations are registered
    # before we generate metrics at those timestamps.
    print("  Phase 1: Generating historical events...")

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
        event = event_generator.generate_event(
            event_type=event_type,
            register_perturbation=False  # We register manually with correct timestamp
        )
        event["timestamp"] = current_time

        # Register perturbation with the correct historical timestamp
        perturbation = create_perturbation_from_event(event)
        if perturbation is not None:
            metrics_generator.perturbation_manager.add(perturbation)

        events.append(event)

    events_store.insert_batch(events)
    print(f"  Stored {len(events)} historical events (with perturbations)\n")

    # --- Phase 2: Generate metrics across all tiers ---
    # Perturbations are already registered, so metrics at event timestamps
    # will reflect the event impact.
    print("  Phase 2: Generating metrics with event correlations...")

    all_metrics = metrics_generator.get_all_metrics()
    total_observations = 0
    observations_by_metric = {m: [] for m in all_metrics}

    tier_start = start_time

    for tier in tiers:
        tier_end = tier_start + tier["duration"]
        num_points = tier["duration"] // tier["interval"]

        print(f"    {tier['name']}: {num_points} points per metric...")

        for i in range(num_points):
            timestamp = tier_start + (i * tier["interval"])

            for metric in all_metrics:
                obs = metrics_generator.generate_observation(metric, timestamp)
                observations_by_metric[metric].append(obs)

        tier_start = tier_end

    # Store observations
    for metric in all_metrics:
        metrics_store.insert_batch(observations_by_metric[metric])
        total_observations += len(observations_by_metric[metric])
        print(f"    {metric}: {len(observations_by_metric[metric])} observations")

    print(f"\n  Total stored: {total_observations} metric observations")

    # Clear perturbations from bootstrap so they don't affect live data
    metrics_generator.perturbation_manager.clear()

    return {
        "observations": total_observations,
        "events": len(events),
        "metrics": len(all_metrics),
        "duration_days": total_duration / 86400
    }


if __name__ == "__main__":
    stats = bootstrap_historical_data(hours=24)
    print("\nBootstrap complete:")
    print(f"  {stats['metrics']} metrics")
    print(f"  {stats['observations']} observations")
    print(f"  {stats['events']} events")
