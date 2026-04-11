"""
Main application entry point.

Orchestrates:
1. Historical data bootstrap
2. WebSocket server for real-time streaming
3. HTTP API server for queries (same process for shared storage)
4. Live metric/event generation
"""
import asyncio
import time
import uvicorn
import json
import os
from pathlib import Path

from simulator.realistic_generator import get_generator, NETWORK_PROFILES
from simulator.event_generator import get_event_generator
from simulator.bootstrap import bootstrap_historical_data
from storage.metrics_store import get_metrics_store
from storage.events_store import get_events_store
from server.websocket_server import get_websocket_server
from server.http_api import app


def _get_ap_list():
    """Load AP names from config file."""
    config_path = Path(__file__).parent / "simulator" / "config_enterprise.json"
    
    if not config_path.exists():
        # Fallback if enterprise config missing
        return ["AP-Floor1-01", "AP-Floor1-02", "AP-Floor2-01", 
                "AP-Floor2-02", "AP-Floor3-01", "AP-Floor3-02"]
    
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    # Extract AP names from ap_topology section
    # Each AP is a key in the ap_topology dict (skip metadata keys like "description")
    ap_names = []
    if "ap_topology" in config:
        for key in config["ap_topology"].keys():
            if key.startswith("AP-"):
                ap_names.append(key)
    
    return ap_names if ap_names else ["_global"]


async def stream_metrics_loop():
    """
    Continuously generate and broadcast metric observations.
    
    Generates observations for all metrics across all APs at each tick,
    stores them, and broadcasts them to connected WebSocket clients.
    Uses real wall clock time for live observations.
    """
    generator = get_generator()
    metrics_store = get_metrics_store()
    ws_server = get_websocket_server()
    
    # Load AP list from config
    ap_list = _get_ap_list()
    
    print(f"Starting metric streaming loop (30 sec interval) for {len(ap_list)} APs...")
    
    while True:
        try:
            # Use actual current time for live observations
            current_time = int(time.time())
            
            # Generate observation for each metric at current time for each AP
            for metric in generator.get_all_metrics():
                ap_observations = []
                for ap_name in ap_list:
                    # Generate with classifiers for WebSocket broadcast (FD-013)
                    observation = generator.generate_observation(
                        metric, 
                        timestamp=current_time, 
                        entity=ap_name,
                        include_classifiers=True
                    )
                    
                    # Store it
                    metrics_store.insert_observation(observation)
                    ap_observations.append(observation)
                
                # Flush classifier cache once per metric (not per AP)
                metrics_store.flush_classifiers()
                
                # Broadcast aggregated value (mean across all APs)
                mean_value = sum(obs["value"] for obs in ap_observations) / len(ap_observations)
                
                # Aggregate classifiers (average across APs)
                aggregated_classifiers = _aggregate_classifiers([obs.get("classifiers", []) for obs in ap_observations])
                
                aggregated_observation = {
                    "timestamp": current_time,
                    "metric": metric,
                    "value": mean_value,
                    "entity": None,  # Aggregated data has no specific entity
                    "classifiers": aggregated_classifiers
                }
                await ws_server.broadcast_metric(aggregated_observation)
            
            # No need to tick() - we use actual wall clock time
            # The generator's internal state (noise, correlations) is preserved
            # but timestamps come from real time
            
            # Wait 30 seconds before next batch
            await asyncio.sleep(30)
            
        except Exception as e:
            print(f"Error in metrics loop: {e}")
            await asyncio.sleep(1)


def _aggregate_classifiers(classifier_lists):
    """
    Aggregate classifier breakdowns across multiple APs.
    
    Computes average value for each classifier and determines status based on average.
    
    Args:
        classifier_lists: List of classifier lists from different APs
        
    Returns:
        List of aggregated classifiers
    """
    from collections import defaultdict
    
    if not classifier_lists or all(not c for c in classifier_lists):
        return []
    
    # Group classifiers by name
    classifier_groups = defaultdict(list)
    for classifiers in classifier_lists:
        if classifiers:
            for classifier in classifiers:
                classifier_groups[classifier["name"]].append(classifier)
    
    # Aggregate each classifier
    aggregated = []
    for name, group in classifier_groups.items():
        avg_value = sum(c["value"] for c in group) / len(group)
        avg_contribution = sum(c["contribution"] for c in group) / len(group)
        avg_weight = sum(c["weight"] for c in group) / len(group) if group[0].get("weight") is not None else None
        
        # Determine status based on average value
        # Simple majority vote or use first one's status
        # For simplicity, use the most common status
        status_counts = defaultdict(int)
        for c in group:
            status_counts[c["status"]] += 1
        most_common_status = max(status_counts.items(), key=lambda x: x[1])[0]
        
        aggregated.append({
            "name": name,
            "value": round(avg_value, 4),
            "status": most_common_status,
            "contribution": round(avg_contribution, 4),
            "weight": round(avg_weight, 4) if avg_weight is not None else None
        })
    
    return aggregated


async def stream_events_loop():
    """
    Handle event generation and broadcasting.
    
    Events are generated by the scheduler, we just register callbacks.
    """
    event_generator = get_event_generator()
    metrics_generator = get_generator()
    events_store = get_events_store()
    ws_server = get_websocket_server()

    # Wire event generator to metrics generator for perturbation causality
    event_generator.set_metrics_generator(metrics_generator)

    # Register callback to handle generated events
    async def handle_event(event):
        # Store it
        events_store.insert_event(event)
        
        # Broadcast it
        await ws_server.broadcast_event(event)
    
    # Wrap sync callback for async scheduler
    def sync_callback(event):
        asyncio.create_task(handle_event(event))
    
    event_generator.register_callback(sync_callback)
    
    # Schedule random events every 5 minutes
    event_generator.schedule_random_events(avg_interval_minutes=5)
    
    # Start scheduler
    event_generator.start()
    
    print("Event generator started (random events every 5 min)")


async def cleanup_old_data_loop():
    """
    Delete data older than 30 days to maintain rolling window.
    
    Runs once per day at 3:00 AM to minimize impact on performance.
    For continuous operation, this keeps storage bounded while avoiding
    frequent expensive delete operations on CSV storage.
    """
    from datetime import datetime, timedelta
    
    metrics_store = get_metrics_store()
    events_store = get_events_store()
    
    # Retention period: 30 days
    retention_seconds = 30 * 24 * 3600
    
    print(f"Data cleanup task started (runs daily at 3:00 AM, keeps {retention_seconds/86400:.0f} days)")
    
    while True:
        try:
            # Calculate next 3 AM
            now = datetime.now()
            next_run = now.replace(hour=3, minute=0, second=0, microsecond=0)
            
            # If it's already past 3 AM today, schedule for tomorrow
            if next_run <= now:
                next_run += timedelta(days=1)
            
            # Wait until scheduled time
            wait_seconds = (next_run - now).total_seconds()
            print(f"Next cleanup scheduled for: {next_run.strftime('%Y-%m-%d %H:%M:%S')}")
            
            await asyncio.sleep(wait_seconds)
            
            # Perform cleanup
            print(f"\nRunning daily cleanup at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}...")
            cutoff = int(time.time()) - retention_seconds
            
            metrics_deleted = metrics_store.delete_older_than(cutoff)
            events_deleted = events_store.delete_older_than(cutoff)
            
            print(f"Cleanup complete: deleted {metrics_deleted} metrics and {events_deleted} events older than {time.ctime(cutoff)}")
            
            # Reclaim disk space after bulk deletes
            if metrics_deleted > 0:
                metrics_store.vacuum()
            if events_deleted > 0:
                events_store.vacuum()
            print(f"VACUUM complete\n")
            
        except Exception as e:
            print(f"Error in cleanup loop: {e}")
            import traceback
            traceback.print_exc()
            # Wait 1 hour before retrying on error
            await asyncio.sleep(3600)


async def run_backend():
    """
    Run the complete backend system.
    
    1. Bootstrap historical data
    2. Start HTTP API server (in same process for shared storage)
    3. Start WebSocket server
    4. Start metric streaming
    5. Start event streaming
    """
    import os

    print("\n" + "="*60)
    print("Network Monitoring Backend")
    print("="*60)

    # Show available profiles
    current_profile = os.environ.get("NETWORK_PROFILE", "enterprise").lower()
    print(f"\nAvailable network profiles: {', '.join(NETWORK_PROFILES.keys())}")
    print(f"Current profile: {current_profile}")
    print("(Set NETWORK_PROFILE env var to switch, e.g.: NETWORK_PROFILE=hospital python main.py)\n")

    # Check if we should skip bootstrap (for continuous operation)
    skip_bootstrap = os.environ.get("SKIP_BOOTSTRAP", "false").lower() == "true"
    
    # Get absolute paths to database files
    from pathlib import Path
    backend_dir = Path(__file__).parent
    db_files = [
        backend_dir / "data" / "metrics.db",
        backend_dir / "data" / "events.db"
    ]
    # Legacy files from TinyFlux era to clean up on fresh start
    legacy_files = [
        backend_dir / "data" / "metrics.csv",
        backend_dir / "data" / "metrics.csv.classifiers.json",
    ]
    
    # Determine if this is first run (no data exists)
    has_existing_data = any(db_file.exists() for db_file in db_files)
    
    if skip_bootstrap and has_existing_data:
        # Continuous operation mode - keep existing data
        print("\n" + "="*60)
        print("CONTINUOUS OPERATION MODE")
        print("="*60)
        print("Existing data found and SKIP_BOOTSTRAP=true")
        print("Preserving historical data and resuming live generation")
        
        # Show age of existing data
        metrics_db = db_files[0]
        if metrics_db.exists():
            age_seconds = time.time() - metrics_db.stat().st_mtime
            age_hours = age_seconds / 3600
            print(f"Data file last modified: {age_hours:.1f} hours ago")
        print("="*60 + "\n")
        
    else:
        # Fresh start - clear and regenerate
        if skip_bootstrap and not has_existing_data:
            print("\nSKIP_BOOTSTRAP=true but no existing data found")
            print("Performing initial bootstrap...\n")
        else:
            print("\nClearing existing data for fresh start...")
        
        # Delete database files entirely to ensure clean slate
        for db_file in db_files:
            if db_file.exists():
                print(f"  Deleting {db_file.name}...")
                db_file.unlink()
        # Clean up legacy TinyFlux files
        for legacy_file in legacy_files:
            if legacy_file.exists():
                print(f"  Deleting legacy {legacy_file.name}...")
                legacy_file.unlink()
        
        # Reset singleton instances to get fresh database connections
        from storage.metrics_store import reset_metrics_store
        from storage.events_store import reset_events_store
        reset_metrics_store()
        reset_events_store()
        
        # Bootstrap tiered historical data ending at current time
        # Duration is determined by tier configuration (~30 days)
        bootstrap_historical_data()
        print()
    
    # Reset generator to start live streaming (preserves noise state for continuity)
    from simulator.realistic_generator import reset_for_live_streaming
    reset_for_live_streaming()
    
    # Ports are configurable via environment variables for VM deployment
    http_port = int(os.environ.get("HTTP_PORT", "5030"))
    ws_port = int(os.environ.get("WS_PORT", "5031"))

    # Start HTTP API server in background task (same process!)
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=http_port,
        log_level="info"
    )
    server = uvicorn.Server(config)
    
    print("\n" + "="*60)
    print(f"FastAPI HTTP server starting on http://0.0.0.0:{http_port}")
    print(f"API docs available at http://localhost:{http_port}/docs")
    print("="*60 + "\n")
    
    # Start WebSocket server
    ws_server = get_websocket_server(host="0.0.0.0", port=ws_port)
    await ws_server.start()
    
    # Start all services in parallel
    await asyncio.gather(
        server.serve(),  # HTTP API
        stream_metrics_loop(),
        stream_events_loop(),
        cleanup_old_data_loop()  # Periodic cleanup to maintain 30-day window
    )


if __name__ == "__main__":
    # Run everything in single process so storage is shared
    try:
        asyncio.run(run_backend())
    except KeyboardInterrupt:
        print("\n\nShutting down...")
        print("Shutdown complete")
