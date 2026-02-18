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
    entity: Optional[str] = Field(None, description="Entity name (AP, switch, etc.) or null for aggregated")


class Distribution(BaseModel):
    """Statistical distribution of metric values."""
    p1: float = Field(..., description="1st percentile")
    p5: float = Field(..., description="5th percentile")
    p10: float = Field(..., description="10th percentile")
    p25: float = Field(..., description="25th percentile")
    p50: float = Field(..., description="50th percentile (median)")
    p75: float = Field(..., description="75th percentile")
    p90: float = Field(..., description="90th percentile")
    p95: float = Field(..., description="95th percentile")
    p99: float = Field(..., description="99th percentile")
    mean: float = Field(..., description="Mean value")
    stddev: float = Field(..., description="Standard deviation")
    count: int = Field(..., description="Number of observations")


class MetricResponse(BaseModel):
    """Response for metric query."""
    metric: str = Field(..., description="Metric name")
    start: int = Field(..., description="Start timestamp")
    end: int = Field(..., description="End timestamp")
    observations: List[MetricObservation] = Field(..., description="Observations in range")
    distribution: Optional[Distribution] = Field(None, description="Computed distribution over entire range")


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

class HourlyDistribution(BaseModel):
    """Distribution for a specific hour of day."""
    hour: int = Field(..., description="Hour of day (0-23)")
    distribution: Distribution = Field(..., description="Distribution for this hour")
    fallback_source: str = Field(..., description="Source: data|entity_4h_bin|global_scaled|synthetic_config")
    sample_count: int = Field(..., description="Number of observations used")


class BaselineResponse(BaseModel):
    """Response for baseline distribution query."""
    metric: str = Field(..., description="Metric name")
    entity: Optional[str] = Field(None, description="Entity (AP) name, or None for global")
    lookback_days: int = Field(..., description="Days of history used")
    timezone: str = Field(..., description="Timezone used for hour-of-day grouping")
    hourly_distributions: List[HourlyDistribution] = Field(..., description="24 hourly baselines")