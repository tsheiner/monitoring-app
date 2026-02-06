"""
Bootstrap historical data generation with tiered aggregation strategy.

Generates initial historical data for all metrics and events using
a tiered resolution approach to minimize storage while maintaining detail
where it matters most (recent data).

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
from typing import Dict, List

from simulator.realistic_generator import get_generator, reset_for_live_streaming
from simulator.event_generator import get_event_generator
from storage.metrics_store import get_metrics_store
from storage.events_store import get_events_store


def bootstrap_historical_data(days: int = 90) -> Dict[str, int]:
    """
    Generate and store tiered historical data for all metrics and events.
    
    Uses aggregation strategy to minimize storage:
    - Recent data has high resolution
    - Older data is aggregated into larger buckets
    
    Args:
        days: Number of days of history to generate (default 90)
        
    Returns:
        Dict with counts of generated data
    """
    print(f"\nBootstrapping {days} days of tiered historical data...")
    print("Aggregation strategy:")
    print("  Raw (10s): Last 1 minute")
    print("  1-min: 1 min to 1 hour")
    print("  5-min: 1-4 hours")
    print("  15-min: 4-24 hours")
    print("  1-hour: 1-7 days")
    print("  6-hour: 7-30 days")
    print("  12-hour: 30-90 days\n")
    
    now = int(time.time())
    start_time = now - (days * 86400)
    metrics_generator = get_generator(start_time=start_time)
    event_generator = get_event_generator()
    metrics_store = get_metrics_store()
    events_store = get_events_store()

    # Define time tiers in CHRONOLOGICAL order (oldest to newest)
    # This ensures noise state flows naturally through time
    tiers = [
        {"name": "12-hour", "duration": 5184000, "interval": 43200},     # 30-90 days ago
        {"name": "6-hour", "duration": 1987200, "interval": 21600},      # 7-30 days ago
        {"name": "1-hour", "duration": 518400, "interval": 3600},        # 1-7 days ago
        {"name": "15-min", "duration": 72000, "interval": 900},          # 4-24 hrs ago
        {"name": "5-min", "duration": 10800, "interval": 300},           # 1-4 hrs ago
        {"name": "1-min", "duration": 3540, "interval": 60},             # 1 min - 1 hr ago
        {"name": "Raw (10s)", "duration": 60, "interval": 10},           # Last 1 min
    ]

    # Generate ALL metrics together in chronological order
    # This ensures consistent correlations and smooth noise across metrics
    all_metrics = metrics_generator.get_all_metrics()
    total_observations = 0
    observations_by_metric = {m: [] for m in all_metrics}

    # Calculate tier boundaries (working forward from start)
    tier_start = start_time

    for tier in tiers:
        tier_end = tier_start + tier["duration"]
        num_points = tier["duration"] // tier["interval"]

        print(f"  Generating {tier['name']}: {num_points} points per metric...")

        # Generate all timestamps for this tier
        for i in range(num_points):
            timestamp = tier_start + (i * tier["interval"])

            # Generate ALL metrics at this timestamp (maintains correlations)
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
    
    # Generate historical events
    # Roughly 1 event per hour
    print("  Generating historical events...")
    events = []
    
    num_events = days * 24  # 1 event per hour
    event_interval = (days * 86400) // num_events
    
    for i in range(num_events):
        event = event_generator.generate_event(
            event_type=event_generator.EVENT_TYPES[i % len(event_generator.EVENT_TYPES)]
        )
        # Backdate the event
        event["timestamp"] = now - (days * 86400) + (i * event_interval)
        events.append(event)
    
    events_store.insert_batch(events)
    print(f"  Stored {len(events)} historical events\n")

    # Reset generator for live streaming while preserving noise state.
    # This ensures live data flows smoothly from where historical data ended.
    reset_for_live_streaming()

    return {
        "observations": total_observations,
        "events": len(events),
        "metrics": len(all_metrics),
        "days": days
    }


if __name__ == "__main__":
    stats = bootstrap_historical_data(hours=24)
    print("\nBootstrap complete:")
    print(f"  {stats['metrics']} metrics")
    print(f"  {stats['observations']} observations")
    print(f"  {stats['events']} events")
    print(f"  {stats['hours']} hours of history")
