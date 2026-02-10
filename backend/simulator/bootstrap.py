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


def bootstrap_historical_data(days: int = None) -> Dict[str, int]:
    """
    Generate and store tiered historical data for all metrics and events.
    
    Uses aggregation strategy to minimize storage:
    - Recent data has high resolution (10s intervals)
    - Older data is aggregated (1min, 5min, 15min, 1hr, 6hr, 12hr intervals)
    
    The tiers are defined with clean durations (exact multiples of intervals)
    rather than trying to hit an exact number of days. This makes the code
    bulletproof for prototype usage.
    
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
    # Each duration is an EXACT MULTIPLE of its interval for clean boundaries
    # Total: ~30 days of history (simpler for prototype, can extend later)
    tiers = [
        {"name": "12-hour", "duration": 1728000, "interval": 43200},     # 20 days (40 intervals)
        {"name": "6-hour", "duration": 518400, "interval": 21600},       # 6 days (24 intervals)
        {"name": "1-hour", "duration": 259200, "interval": 3600},        # 3 days (72 intervals)
        {"name": "15-min", "duration": 43200, "interval": 900},          # 12 hours (48 intervals)
        {"name": "5-min", "duration": 10800, "interval": 300},           # 3 hours (36 intervals)
        {"name": "1-min", "duration": 3600, "interval": 60},             # 1 hour (60 intervals)
        {"name": "Raw (10s)", "duration": 7200, "interval": 10},         # 2 hours (720 intervals)
    ]

    # Calculate total duration from tiers
    total_duration = sum(t["duration"] for t in tiers)
    start_time = now - total_duration
    
    print(f"Historical data range: {time.ctime(start_time)} to {time.ctime(now)}")
    print(f"Total duration: {total_duration:,} seconds ({total_duration/86400:.1f} days)\n")
    
    # Initialize generators and storage
    metrics_generator = get_generator(start_time=start_time)
    event_generator = get_event_generator()
    metrics_store = get_metrics_store()
    events_store = get_events_store()
    
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
    
    # Generate historical events with randomized timing
    # Uses Poisson process for natural event spacing
    print("  Generating historical events...")
    events = []

    import random

    # Event weights (some events are rarer than others)
    event_weights = {
        "device_restart": 0.15,
        "device_crash": 0.05,  # Rare
        "firmware_update": 0.10,
        "config_change": 0.35,  # Common
        "ai_action": 0.35,  # Common
    }
    event_types = list(event_weights.keys())
    weights = list(event_weights.values())

    # Average ~1 event per hour, but with random spacing
    avg_interval_seconds = 3600  # 1 hour average
    current_time = start_time

    while current_time < now:
        # Exponential distribution for inter-arrival times (Poisson process)
        # This creates natural clustering - sometimes events come quickly,
        # sometimes there are longer gaps
        interval = random.expovariate(1.0 / avg_interval_seconds)
        # Clamp to reasonable bounds (5 minutes to 4 hours)
        interval = max(300, min(14400, interval))

        current_time += int(interval)

        if current_time >= now:
            break

        # Select event type based on weights
        event_type = random.choices(event_types, weights=weights)[0]
        event = event_generator.generate_event(event_type=event_type)
        event["timestamp"] = current_time
        events.append(event)

    events_store.insert_batch(events)
    print(f"  Stored {len(events)} historical events (randomized timing)\n")

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
    print(f"  {stats['hours']} hours of history")
