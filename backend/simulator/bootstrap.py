"""
Bootstrap historical data generation.

Generates initial historical data for all metrics and some events
to provide a realistic starting state.
"""
import time
from typing import Dict

from simulator.metrics_generator import get_generator
from simulator.event_generator import get_event_generator
from storage.metrics_store import get_metrics_store
from storage.events_store import get_events_store


def bootstrap_historical_data(hours: int = 24) -> Dict[str, int]:
    """
    Generate and store historical data for all metrics and events.
    
    Args:
        hours: Number of hours of history to generate
        
    Returns:
        Dict with counts of generated data
    """
    print(f"Bootstrapping {hours} hours of historical data...")
    
    metrics_generator = get_generator(start_time=int(time.time()) - (hours * 3600))
    event_generator = get_event_generator()
    metrics_store = get_metrics_store()
    events_store = get_events_store()
    
    # Generate historical metrics
    all_metrics = metrics_generator.get_all_metrics()
    total_observations = 0
    
    for metric in all_metrics:
        print(f"  Generating {metric}...")
        observations = metrics_generator.generate_historical(
            metric=metric,
            hours=hours,
            interval_seconds=10
        )
        metrics_store.insert_batch(observations)
        total_observations += len(observations)
    
    print(f"  Stored {total_observations} metric observations")
    
    # Generate some historical events
    # Roughly 1 event per hour per entity
    print("  Generating historical events...")
    events = []
    
    num_events = hours * 6  # Average 6 events per hour across all entities
    event_interval = (hours * 3600) // num_events
    
    for i in range(num_events):
        event = event_generator.generate_event(
            event_type=event_generator.EVENT_TYPES[i % len(event_generator.EVENT_TYPES)]
        )
        # Backdate the event
        event["timestamp"] = int(time.time()) - (hours * 3600) + (i * event_interval)
        events.append(event)
    
    events_store.insert_batch(events)
    print(f"  Stored {len(events)} historical events")
    
    return {
        "observations": total_observations,
        "events": len(events),
        "metrics": len(all_metrics),
        "hours": hours
    }


if __name__ == "__main__":
    stats = bootstrap_historical_data(hours=24)
    print("\nBootstrap complete:")
    print(f"  {stats['metrics']} metrics")
    print(f"  {stats['observations']} observations")
    print(f"  {stats['events']} events")
    print(f"  {stats['hours']} hours of history")
