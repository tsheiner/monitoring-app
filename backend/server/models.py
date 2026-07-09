"""
Pydantic models for API request/response validation.
"""
from typing import Optional, Dict, List, Literal
from pydantic import BaseModel, Field


class ClassifierStatus(BaseModel):
    """Status of a single classifier contributing to a metric value."""
    name: str = Field(..., description="Classifier name (e.g., 'dhcp', 'dns', 'association')")
    value: float = Field(..., description="Classifier value (e.g., success rate)")
    status: Literal["green", "yellow", "red"] = Field(..., description="Health status based on bootstrap-derived thresholds")
    contribution: float = Field(..., description="Weight/contribution to parent metric (0.0-1.0)")
    weight: Optional[float] = Field(None, description="Optional classifier weight in metric calculation")


class MetricObservation(BaseModel):
    """Single metric observation."""
    timestamp: int = Field(..., description="Unix timestamp in seconds")
    metric: str = Field(..., description="Metric name")
    value: float = Field(..., description="Observed value")
    entity: Optional[str] = Field(None, description="Entity name (AP, switch, etc.) or null for aggregated")
    classifiers: Optional[List[ClassifierStatus]] = Field(None, description="Optional classifier breakdown for this observation")


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
    event_source: Optional[str] = Field(None, description="background|scenario")
    event_group: Optional[str] = Field(None, description="Event group for UI grouping")
    affected_classifiers: Optional[List[str]] = Field(None, description="Affected classifiers")
    scenario_id: Optional[str] = Field(None, description="Scenario ID for scenario events")
    scenario_run_id: Optional[str] = Field(None, description="Scenario run ID")
    metadata: Optional[Dict] = Field(None, description="Event-specific data")


class EventsResponse(BaseModel):
    """Response for events query."""
    start: int = Field(..., description="Start timestamp")
    end: int = Field(..., description="End timestamp")
    events: List[Event] = Field(..., description="Events in range")
    count: int = Field(..., description="Total events returned")


class ScenarioStepModel(BaseModel):
    """A scheduled catalog event within a scenario definition or run."""
    offset_seconds: int = Field(..., description="Offset from scenario start")
    event_type: str = Field(..., description="Catalog event type")
    severity: Optional[str] = Field(None, description="Fixed event severity, if any")
    entity_selector: Optional[str] = Field(None, description="Entity selection strategy")
    description: Optional[str] = Field(None, description="Step description")


class ScenarioModel(BaseModel):
    """Scenario definition."""
    scenario_id: str = Field(..., description="Scenario identifier")
    label: str = Field(..., description="Display label")
    description: str = Field(..., description="Scenario description")
    default_severity: str = Field(..., description="Default scenario severity")
    allowed_severities: List[str] = Field(..., description="Allowed scenario severities")
    steps: List[ScenarioStepModel] = Field(..., description="Scheduled events")


class ScenariosResponse(BaseModel):
    """Response for scenario listing."""
    scenarios: List[ScenarioModel] = Field(..., description="Available scenarios")


class ScenarioTriggerRequest(BaseModel):
    """Request to trigger a scenario."""
    scenario_id: str = Field(..., description="Scenario identifier")
    entity: str = Field(..., description="Target AP entity")
    severity: Literal["warning", "critical"] = Field(
        "warning",
        description="Scenario severity"
    )


class ScenarioTriggerResponse(BaseModel):
    """Response after triggering a scenario."""
    scenario_run_id: str = Field(..., description="Scenario run identifier")
    scenario_id: str = Field(..., description="Scenario identifier")
    entity: str = Field(..., description="Target AP entity")
    severity: str = Field(..., description="Scenario severity")
    started_at: int = Field(..., description="Start timestamp")
    ends_at: int = Field(..., description="Estimated end timestamp")
    scheduled_events: List[Dict] = Field(..., description="Scheduled catalog events")
    emitted_events: List[Event] = Field(..., description="Events emitted immediately")


class ActiveScenarioRun(BaseModel):
    """Active scenario run."""
    scenario_run_id: str = Field(..., description="Scenario run identifier")
    scenario_id: str = Field(..., description="Scenario identifier")
    label: str = Field(..., description="Scenario label")
    entity: str = Field(..., description="Target AP entity")
    severity: str = Field(..., description="Scenario severity")
    started_at: int = Field(..., description="Start timestamp")
    ends_at: int = Field(..., description="Estimated end timestamp")
    status: str = Field(..., description="Run status")
    emitted_count: int = Field(..., description="Number of emitted scenario events")
    total_events: int = Field(..., description="Total scheduled events")
    scheduled_events: List[Dict] = Field(..., description="Scheduled catalog events")


class ActiveScenariosResponse(BaseModel):
    """Response for active scenario runs."""
    active: List[ActiveScenarioRun] = Field(..., description="Active scenario runs")


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


class CurrentClassifiersResponse(BaseModel):
    """Response for current classifier state of a metric."""
    metric: str = Field(..., description="Metric name")
    timestamp: int = Field(..., description="Timestamp of observation")
    value: float = Field(..., description="Metric value")
    entity: Optional[str] = Field(None, description="Entity name")
    classifiers: List[ClassifierStatus] = Field(..., description="Current classifier breakdown")


class ClassifierHourlyDistribution(BaseModel):
    """Distribution for a classifier at a specific hour of day."""
    hour: int = Field(..., description="Hour of day (0-23)")
    distribution: Distribution = Field(..., description="Distribution for this hour")
    sample_count: int = Field(..., description="Number of observations used")


class ClassifierBaselineResponse(BaseModel):
    """Response for classifier baseline query."""
    classifier: str = Field(..., description="Classifier name")
    lookback_days: int = Field(..., description="Days of history used")
    hourly_distributions: List[ClassifierHourlyDistribution] = Field(..., description="24 hourly baselines")
