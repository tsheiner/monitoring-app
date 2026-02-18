"""
FastAPI HTTP API for historical data queries.

Provides endpoints for querying metrics with distributions and events.
"""
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
    BaselineResponse
)
from storage.metrics_store import get_metrics_store
from storage.events_store import get_events_store
from simulator.metrics_generator import MetricsGenerator


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
    metrics = MetricsGenerator.get_all_metrics()
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
    if metric not in MetricsGenerator.get_all_metrics():
        raise HTTPException(status_code=404, detail=f"Metric '{metric}' not found")
    
    # Validate time range
    if start >= end:
        raise HTTPException(status_code=400, detail="Start must be before end")
    
    # Query storage
    store = get_metrics_store()
    
    # Handle aggregation: if entity="_aggregated", compute mean across all entities per timestamp
    if entity == "_aggregated":
        all_observations = store.query_range(metric, start, end, entity=None)
        # Group by timestamp and compute mean
        from collections import defaultdict
        timestamp_values = defaultdict(list)
        for obs in all_observations:
            timestamp_values[obs["timestamp"]].append(obs["value"])
        
        observations = [
            {
                "timestamp": ts,
                "metric": metric,
                "value": sum(values) / len(values),
                "entity": None
            }
            for ts, values in sorted(timestamp_values.items())
        ]
    elif entity == "_all":
        observations = store.query_range(metric, start, end, entity=None)
    else:
        observations = store.query_range(metric, start, end, entity=entity)
    
    distribution = store.compute_distribution(metric, start, end, entity=None if entity == "_aggregated" else entity if entity != "_all" else None)
    
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
    if metric not in MetricsGenerator.get_all_metrics():
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


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}
