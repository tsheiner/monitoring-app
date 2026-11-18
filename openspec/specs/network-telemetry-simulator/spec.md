## Purpose

Define the supported behavior of the prototype's simulated network telemetry
service: generated metrics and background events, their history and baselines,
and the interfaces used by consumers.

This baseline follows the running implementation and its tests. The scenario
catalog, manual scenario triggering, active scenario runs, and timed incident
sequences are experimental and are not part of this supported baseline. They
can be specified as a future feature before further development.

## Requirements

### Requirement: Generate network metrics for configured access points

The simulator SHALL generate observations for the seven supported metrics:
`time_to_connect`, `throughput`, `coverage`, `capacity`, `roaming`,
`successful_connects`, and `ap_health`. Each observation SHALL include a Unix
timestamp, metric name, numeric value, and entity when generated for a specific
access point. A complete frame for one entity and timestamp SHALL derive all
requested metrics from the same simulator state at that timestamp.

#### Scenario: Generate a complete access point frame

- **WHEN** the simulator generates a frame for a configured access point
- **THEN** it returns observations for the supported metrics with a shared
  timestamp and that access point as the entity

#### Scenario: Reject an unknown metric

- **WHEN** a consumer requests an unsupported metric from the generator
- **THEN** the simulator reports the metric as unknown instead of returning an
  observation for it

### Requirement: Reflect the configured network profile and natural variation

The simulator SHALL use the selected network profile and configured access
point topology to shape telemetry. Supported profiles are enterprise, campus,
and hospital, with enterprise as the default. Metric behavior SHALL include
time-of-day patterns and natural variation, with shared network conditions
allowing related metrics to move together while access points retain distinct
behavior.

#### Scenario: Select a network profile

- **WHEN** the backend starts with a supported network profile selected
- **THEN** generated metrics and background event behavior reflect that profile

#### Scenario: Generate telemetry for multiple access points

- **WHEN** a frame is generated for each configured access point at the same
  timestamp
- **THEN** each access point receives its own observation set and state

### Requirement: Model causal effects and recovery

The simulator SHALL derive metrics from classifier health values. Generated
events SHALL apply the configured temporary effects to their affected
classifiers, and the resulting metric observations SHALL reflect those effects.
Effects SHALL expire or recover according to the event's configured recovery
policy. A classifier shared by multiple metrics SHALL allow one event to affect
each dependent metric.

#### Scenario: Apply a background event effect

- **WHEN** a generated event affects one or more classifiers
- **THEN** subsequent observations reflect the changed classifier state in the
  metrics that depend on those classifiers

#### Scenario: Recover after a temporary effect

- **WHEN** an event's configured effect reaches its recovery end
- **THEN** the affected classifier contribution returns toward its unperturbed
  state and generated metrics reflect that recovery

### Requirement: Generate and retain profile-aware background events

The simulator SHALL generate background events according to the selected
profile and event catalog. Each stored event SHALL include its timestamp, event
type, human-readable message, and any applicable severity, entity, and
event-specific metadata. Event records MAY include source, event group, and
affected classifier information when available.

#### Scenario: Generate a background event

- **WHEN** the background event scheduler emits an event
- **THEN** the event is available to historical queries and is published to
  connected live consumers

#### Scenario: Retain a rolling history

- **WHEN** stored metric observations and events age beyond the retention
  window
- **THEN** the service removes data older than the configured 30-day rolling
  window

### Requirement: Bootstrap historical telemetry and baselines

On a fresh start, the backend SHALL create historical telemetry and hourly
baseline data before serving the dashboard's normal monitoring view. Baselines
SHALL describe the typical hourly distribution of metric values and include
sample or fallback information needed to interpret the result. In continuous
operation with existing data, the backend SHALL preserve the stored history and
ensure its baseline artifact is current for the active profile and generator.

#### Scenario: Start with no existing history

- **WHEN** the backend starts without existing metric and event history
- **THEN** it bootstraps historical data and baseline information before live
  telemetry is served

#### Scenario: Resume with existing history

- **WHEN** the backend starts in continuous-operation mode with existing data
- **THEN** it preserves that history and checks that the baseline artifact
  matches the active profile and generator

### Requirement: Query metric history and distributions

The HTTP API SHALL list supported metrics and return observations for a valid
metric and time range. Metric queries SHALL support an individual entity, all
entities, or timestamp-level aggregation across entities. The response SHALL
include the requested time bounds and a statistical distribution when data is
available. Invalid metrics and invalid time ranges SHALL return an error.

#### Scenario: Query aggregated metric history

- **WHEN** a consumer requests a supported metric over a valid time range using
  the aggregated entity selection
- **THEN** the API returns one aggregated observation per timestamp with the
  range distribution

#### Scenario: Query a specific entity

- **WHEN** a consumer requests a supported metric for one entity and time range
- **THEN** the API returns only observations for that entity within the range

### Requirement: Query hourly baselines and classifier diagnostics

The HTTP API SHALL provide hourly baseline distributions for supported metrics
and classifiers. Metric baseline responses SHALL identify the metric, entity
scope, lookback period, timezone, and hourly distributions. Classifier
diagnostic responses SHALL expose the current classifier breakdown or its
hourly baseline when data is available.

#### Scenario: Query a metric baseline

- **WHEN** a consumer requests a supported metric baseline
- **THEN** the API returns hourly distributions and the metadata needed to
  interpret their source and sample coverage

#### Scenario: Query classifier diagnostics

- **WHEN** a consumer requests current classifier details or a classifier
  baseline
- **THEN** the API returns the available classifier values, health statuses,
  contributions, or hourly distributions for that classifier

### Requirement: Query events by time and event attributes

The HTTP API SHALL return events within a valid time range and SHALL support
optional filtering by event type, entity, and severity. The response SHALL
include the time bounds, matching event records, and the returned event count.

#### Scenario: Query events with filters

- **WHEN** a consumer requests events for a time range with one or more
  supported filters
- **THEN** the API returns only events matching the time range and supplied
  filters

### Requirement: Publish live metric and event updates

The WebSocket interface SHALL broadcast generated metric and event messages to
connected clients. Live metric messages SHALL represent the aggregate across
configured access points for a timestamp and include the metric name, timestamp,
and value. Event messages SHALL include the generated event fields. The server
uses broadcast delivery; clients do not need to subscribe to individual metric
or event types.

#### Scenario: Receive a live metric update

- **WHEN** a metric frame is generated for the configured access points
- **THEN** connected clients receive the aggregate metric update for that frame

#### Scenario: Receive a live event update

- **WHEN** the background event scheduler emits an event
- **THEN** connected clients receive that event as a live event message
