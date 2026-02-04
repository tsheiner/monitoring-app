"""
Pydantic models for API request/response validation.
"""
from typing import Optional, Dict, List
from pydantic import BaseModel, Field


class MetricObservation(BaseModel):
    """Single metric observation."""
    timestamp: int = Field(..., description="Unix timestamp in seconds")
    metric: str = Field(..., description="Metric name")
    value: float = Field(..., description="Observed value")


class Distribution(BaseModel):
    """Statistical distribution of metric values."""
    p5: float = Field(..., description="5th percentile")
    p25: float = Field(..., description="25th percentile")
    p50: float = Field(..., description="50th percentile (median)")
    p75: float = Field(..., description="75th percentile")
    p95: float = Field(..., description="95th percentile")
    mean: float = Field(..., description="Mean value")
    stddev: float = Field(..., description="Standard deviation")
    count: int = Field(..., description="Number of observations")


class MetricResponse(BaseModel):
    """Response for metric query with distribution."""
    metric: str = Field(..., description="Metric name")
    start: int = Field(..., description="Start timestamp")
    end: int = Field(..., description="End timestamp")
    observations: List[MetricObservation] = Field(..., description="Observations in range")
    distribution: Optional[Distribution] = Field(None, description="Computed distribution")


class Event(BaseModel):
    """Network event."""
    id: Optional[int] = Field(None, description="Event ID (for stored events)")
    timestamp: int = Field(..., description="Unix timestamp in seconds")
    event_type: str = Field(..., description="Event category")
    severity: Optional[str] = Field(None, description="info|warning|critical")
    entity: Optional[str] = Field(None, description="Affected device/system")
    message: str = Field(..., description="Human-readable description")
    metadata: Optional[Dict] = Field(None, description="Event-specific data")


class EventsResponse(BaseModel):
    """Response for events query."""
    start: int = Field(..., description="Start timestamp")
    end: int = Field(..., description="End timestamp")
    events: List[Event] = Field(..., description="Events in range")
    count: int = Field(..., description="Total events returned")


class MetricsListResponse(BaseModel):
    """Response for available metrics list."""
    metrics: List[str] = Field(..., description="Available metric names")
