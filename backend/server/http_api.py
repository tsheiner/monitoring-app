"""
FastAPI HTTP API for historical data queries.

Provides endpoints for querying metrics with distributions and events.
"""
import json
import time
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    MetricResponse, 
    MetricObservation,
    Distribution,
    EventsResponse,
    Event,
    MetricsListResponse,
    HourlyDistribution,
    BaselineResponse,
    CurrentClassifiersResponse,
    ClassifierHourlyDistribution,
    ClassifierBaselineResponse
)
from storage.metrics_store import get_metrics_store
from storage.events_store import get_events_store
from simulator.realistic_generator import RealisticMetricsGenerator


# Create FastAPI app
app = FastAPI(
    title="Network Monitoring API",
    description="Historical data and distribution queries for network metrics",
    version="1.0.0"
)

# CORS middleware for browser access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Prototype: allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """API status endpoint."""
    return {
        "status": "ok",
        "service": "network-monitoring-api",
        "version": "1.0.0"
    }


@app.get("/api/metrics", response_model=MetricsListResponse)
async def list_metrics():
    """
    Get list of available metrics.
    
    Returns:
        List of metric names
    """
    metrics = RealisticMetricsGenerator.get_all_metrics()
    return MetricsListResponse(metrics=metrics)


@app.get("/api/metrics/{metric}", response_model=MetricResponse)
async def query_metric(
    metric: str,
    start: int = Query(..., description="Start timestamp (Unix seconds)"),
    end: int = Query(..., description="End timestamp (Unix seconds)"),
    entity: str = Query("_aggregated", description="Entity filter: specific AP name, '_aggregated' for mean across all APs, or '_all' for all entities")
):
    """
    Query metric observations in a time range with computed distribution.
    
    Args:
        metric: Metric name
        start: Start timestamp
        end: End timestamp
        entity: Entity filter (AP name, '_aggregated', or '_all')
        
    Returns:
        Observations and time-bucketed distribution statistics
    """
    # Validate metric name
    if metric not in RealisticMetricsGenerator.get_all_metrics():
        raise HTTPException(status_code=404, detail=f"Metric '{metric}' not found")
    
    # Validate time range
    if start >= end:
        raise HTTPException(status_code=400, detail="Start must be before end")
    
    # Query storage
    store = get_metrics_store()
    
    # Handle aggregation: if entity="_aggregated", compute mean across all entities per timestamp
    if entity == "_aggregated":
        all_observations = store.query_range(metric, start, end, entity=None)
        # Group by timestamp and compute mean value + aggregate classifiers
        from collections import defaultdict
        timestamp_groups = defaultdict(list)
        for obs in all_observations:
            timestamp_groups[obs["timestamp"]].append(obs)

        def _derive_status(value: float, classifiers_list: list) -> str:
            """Derive worst status from a list of per-AP classifier records."""
            statuses = [c.get("status", "green") for c in classifiers_list]
            if "red" in statuses:
                return "red"
            if "yellow" in statuses:
                return "yellow"
            return "green"

        def _aggregate_classifiers(obs_list: list):
            """
            Average classifier values across APs; derive status from worst-of-APs.
            Returns None if no observations have classifiers.
            """
            # Collect per-classifier values across all APs
            classifier_values = defaultdict(list)
            classifier_all_recs = defaultdict(list)
            classifier_weights = {}
            has_any = False
            for obs in obs_list:
                if obs.get("classifiers"):
                    has_any = True
                    for c in obs["classifiers"]:
                        name = c["name"]
                        classifier_values[name].append(c["value"])
                        classifier_all_recs[name].append(c)
                        if "weight" in c:
                            classifier_weights[name] = c["weight"]
            if not has_any:
                return None
            result = []
            for name, vals in classifier_values.items():
                avg_val = sum(vals) / len(vals)
                worst_status = _derive_status(avg_val, classifier_all_recs[name])
                agg_c = {
                    "name": name,
                    "value": avg_val,
                    "status": worst_status,
                    "contribution": 0.0,
                }
                if name in classifier_weights:
                    agg_c["weight"] = classifier_weights[name]
                result.append(agg_c)
            # Preserve insertion order of classifiers (first AP's ordering)
            return result if result else None

        observations = []
        for ts, obs_list in sorted(timestamp_groups.items()):
            values = [o["value"] for o in obs_list]
            agg_classifiers = _aggregate_classifiers(obs_list)
            obs_dict = {
                "timestamp": ts,
                "metric": metric,
                "value": sum(values) / len(values),
                "entity": None,
            }
            if agg_classifiers is not None:
                obs_dict["classifiers"] = agg_classifiers
            observations.append(obs_dict)
    elif entity == "_all":
        observations = store.query_range(metric, start, end, entity=None)
    else:
        observations = store.query_range(metric, start, end, entity=entity)
    
    # Compute distribution from already-fetched observations (avoids re-querying the store)
    distribution = store.compute_distribution(metric, start, end, observations=observations)
    
    # Convert to response models
    obs_models = [
        MetricObservation(**obs) for obs in observations
    ]
    
    dist_model = Distribution(**distribution) if distribution else None
    
    return MetricResponse(
        metric=metric,
        start=start,
        end=end,
        observations=obs_models,
        distribution=dist_model
    )


@app.get("/api/metrics/{metric}/baseline", response_model=BaselineResponse)
async def query_baseline(
    metric: str,
    entity: Optional[str] = Query(None, description="AP entity (e.g., 'AP-Floor1-01') or None for global"),
    lookback_days: int = Query(30, description="Days of history to include"),
    tz: Optional[str] = Query(None, description="Timezone (e.g., 'America/New_York', 'UTC') or None for local")
):
    """
    Query hourly baseline distribution for a metric.
    
    Returns 24 hourly distributions representing the typical daily pattern,
    computed from historical data. Each hour includes percentile bands and
    metadata about data quality (fallback_source, sample_count).
    
    Args:
        metric: Metric name
        entity: Optional AP entity filter
        lookback_days: Number of days of history to analyze
        tz: Optional timezone for hour-of-day grouping
    
    Returns:
        24 hourly baseline distributions with fallback metadata
    """
    # Validate metric name
    if metric not in RealisticMetricsGenerator.get_all_metrics():
        raise HTTPException(status_code=404, detail=f"Metric '{metric}' not found")
    
    # Validate lookback_days
    if lookback_days < 1 or lookback_days > 90:
        raise HTTPException(status_code=400, detail="lookback_days must be between 1 and 90")
    
    # Compute baseline
    store = get_metrics_store()
    hourly_baseline = store.compute_baseline_distribution(
        metric=metric,
        entity=entity,
        lookback_days=lookback_days,
        tz=tz
    )
    
    # Convert to response model
    hourly_models = [
        HourlyDistribution(
            hour=hb["hour"],
            distribution=Distribution(
                p1=hb["distribution"]["p1"],
                p5=hb["distribution"]["p5"],
                p10=hb["distribution"]["p10"],
                p25=hb["distribution"]["p25"],
                p50=hb["distribution"]["p50"],
                p75=hb["distribution"]["p75"],
                p90=hb["distribution"]["p90"],
                p95=hb["distribution"]["p95"],
                p99=hb["distribution"]["p99"],
                mean=hb["distribution"]["mean"],
                stddev=hb["distribution"]["stddev"],
                count=hb.get("sample_count", 0)
            ),
            fallback_source=hb["fallback_source"],
            sample_count=hb["sample_count"]
        )
        for hb in hourly_baseline
    ]
    
    return BaselineResponse(
        metric=metric,
        entity=entity,
        lookback_days=lookback_days,
        timezone=tz or "local",
        hourly_distributions=hourly_models
    )


@app.get("/api/events", response_model=EventsResponse)
async def query_events(
    start: int = Query(..., description="Start timestamp (Unix seconds)"),
    end: int = Query(..., description="End timestamp (Unix seconds)"),
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    entity: Optional[str] = Query(None, description="Filter by entity"),
    severity: Optional[str] = Query(None, description="Filter by severity")
):
    """
    Query events in a time range with optional filters.
    
    Args:
        start: Start timestamp
        end: End timestamp
        event_type: Optional event type filter
        entity: Optional entity filter
        severity: Optional severity filter
        
    Returns:
        List of events matching criteria
    """
    # Validate time range
    if start >= end:
        raise HTTPException(status_code=400, detail="Start must be before end")
    
    # Query storage
    store = get_events_store()
    events = store.query_range(start, end, event_type, entity, severity)
    
    # Convert to response models
    event_models = [Event(**event) for event in events]
    
    return EventsResponse(
        start=start,
        end=end,
        events=event_models,
        count=len(event_models)
    )


@app.get("/api/metrics/{metric}/classifiers/current", response_model=CurrentClassifiersResponse)
async def get_current_classifiers(metric: str):
    """
    Get current classifier breakdown for a metric.
    
    Returns the most recent observation with its classifier decomposition.
    
    Args:
        metric: Metric name
        
    Returns:
        Current observation with classifier breakdown
    """
    # Validate metric name
    if metric not in RealisticMetricsGenerator.get_all_metrics():
        raise HTTPException(status_code=404, detail=f"Metric '{metric}' not found")
    
    # Get latest observation from store
    store = get_metrics_store()
    latest = store.get_latest(metric, limit=1)
    
    if not latest or len(latest) == 0:
        raise HTTPException(status_code=404, detail=f"No data available for metric '{metric}'")
    
    observation = latest[0]
    
    # Check if observation has classifiers
    if "classifiers" not in observation or observation["classifiers"] is None:
        raise HTTPException(status_code=404, detail=f"No classifier data available for metric '{metric}'")
    
    return CurrentClassifiersResponse(
        metric=observation["metric"],
        timestamp=observation["timestamp"],
        value=observation["value"],
        entity=observation.get("entity"),
        classifiers=observation["classifiers"]
    )


@app.get("/api/classifiers/{classifier}/baseline", response_model=ClassifierBaselineResponse)
async def get_classifier_baseline(classifier: str):
    """
    Get hourly baseline distributions for a classifier.
    
    Returns 24 hourly distributions representing typical daily pattern for the classifier,
    computed from historical bootstrap data.
    
    Args:
        classifier: Classifier name (e.g., 'dhcp', 'dns', 'association')
        
    Returns:
        24 hourly baseline distributions
    """
    # Load baselines from file
    baselines_path = Path("data/baselines.json")
    if not baselines_path.exists():
        raise HTTPException(status_code=503, detail="Baseline data not yet available")
    
    with open(baselines_path, 'r') as f:
        baselines = json.load(f)
    
    # Check if classifier exists
    if "classifiers" not in baselines or classifier not in baselines["classifiers"]:
        raise HTTPException(status_code=404, detail=f"Classifier '{classifier}' not found")
    
    classifier_data = baselines["classifiers"][classifier]
    
    # Convert to response models
    hourly_distributions = [
        ClassifierHourlyDistribution(
            hour=hour_data["hour"],
            distribution=Distribution(
                **hour_data["distribution"],
                count=hour_data["sample_count"]  # Use sample_count as count for compatibility
            ),
            sample_count=hour_data["sample_count"]
        )
        for hour_data in classifier_data
    ]
    
    return ClassifierBaselineResponse(
        classifier=classifier,
        lookback_days=int(baselines.get("lookback_days", 30)),
        hourly_distributions=hourly_distributions
    )


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/debug/memory")
async def debug_memory():
    """
    Runtime memory diagnostics for monitoring long-running deployments.

    Reports process RSS, database row counts, and file sizes.
    """
    import os
    import psutil

    proc = psutil.Process(os.getpid())
    mem = proc.memory_info()

    metrics_store = get_metrics_store()
    events_store = get_events_store()

    metrics_count = metrics_store.count_all()
    events_count = events_store.count_events()

    data_dir = Path("data")
    file_sizes = {}
    for name in ["metrics.db", "metrics.db-wal", "events.db", "baselines.json"]:
        p = data_dir / name
        if p.exists():
            file_sizes[name] = round(p.stat().st_size / 1024 / 1024, 2)

    return {
        "rss_mb": round(mem.rss / 1024 / 1024, 1),
        "vms_mb": round(mem.vms / 1024 / 1024, 1),
        "metrics_rows": metrics_count,
        "events_rows": events_count,
        "data_files_mb": file_sizes,
        "uptime_seconds": round(time.time() - proc.create_time()),
    }
