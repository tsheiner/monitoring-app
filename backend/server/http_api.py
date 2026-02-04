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
    MetricsListResponse
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
    end: int = Query(..., description="End timestamp (Unix seconds)")
):
    """
    Query metric observations in a time range with computed distribution.
    
    Args:
        metric: Metric name
        start: Start timestamp
        end: End timestamp
        
    Returns:
        Observations and distribution statistics
    """
    # Validate metric name
    if metric not in MetricsGenerator.get_all_metrics():
        raise HTTPException(status_code=404, detail=f"Metric '{metric}' not found")
    
    # Validate time range
    if start >= end:
        raise HTTPException(status_code=400, detail="Start must be before end")
    
    # Query storage
    store = get_metrics_store()
    observations = store.query_range(metric, start, end)
    distribution = store.compute_distribution(metric, start, end)
    
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
