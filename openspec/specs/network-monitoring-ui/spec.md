## Purpose

Define the supported behavior of the browser-based network monitoring
dashboard. The dashboard lets an operator explore historical and live network
metrics and relate visible metric changes to background network events. It
consumes the telemetry service defined by the `network-telemetry-simulator`
capability.

This baseline follows the running implementation and its tests. Scenario
selection, manual triggering, and active scenario-run views are experimental
and are not included in the supported dashboard behavior yet.

## Requirements

### Requirement: Load a useful monitoring view

The dashboard SHALL load historical metric observations, hourly baselines, and
events for its selected time range, then connect to the live telemetry stream.
On initial load it SHALL show the last 12 hours with `Time to Connect`
selected, live mode enabled, and the metric distribution display enabled.

#### Scenario: Open the dashboard

- **WHEN** a user opens the dashboard and the telemetry service is available
- **THEN** the dashboard loads its initial historical data and baseline, shows
  the default metric and time range, and begins receiving live updates

#### Scenario: Historical data cannot be loaded

- **WHEN** the initial history request fails
- **THEN** the dashboard reports that historical data could not be loaded

### Requirement: Select and compare network metrics

The dashboard SHALL allow users to select from the seven metrics provided by
the telemetry service. Users SHALL be able to inspect one metric or compare
multiple metrics in the same time range. The dashboard SHALL keep at least one
metric selected. When multiple metrics are shown, it SHALL normalize their
traces for visual comparison and hide the single-metric distribution ribbon.

#### Scenario: Inspect one metric

- **WHEN** a user selects one metric
- **THEN** the dashboard shows its observations in their actual units and
  displays its available hourly distribution ribbon

#### Scenario: Compare multiple metrics

- **WHEN** a user selects multiple metrics for comparison
- **THEN** the dashboard shows their traces over the same time range with
  normalized vertical scales and without a distribution ribbon

#### Scenario: Keep one metric selected

- **WHEN** only one metric is selected and the user attempts to deselect it
- **THEN** the dashboard keeps that metric visible

### Requirement: Navigate historical and live time ranges

The dashboard SHALL offer preset ranges of 1, 3, 6, 12, and 24 hours. Users
SHALL be able to pan and zoom the chart to inspect other ranges. The dashboard
SHALL load additional history when navigation moves beyond its buffered data.
Users SHALL be able to pause live following and return to the latest range with
the `Jump to Now` control.

#### Scenario: Change the preset time range

- **WHEN** a user selects a different time range
- **THEN** the dashboard loads and displays observations and events for that
  range

#### Scenario: Pan or zoom beyond buffered history

- **WHEN** a user navigates to a range not present in the chart buffer
- **THEN** the dashboard requests the missing range and updates the chart when
  data arrives

#### Scenario: Return to live monitoring

- **WHEN** a user selects `Jump to Now`
- **THEN** the dashboard loads the latest selected duration and resumes live
  following

### Requirement: Relate metric traces to their distributions

For a single selected metric, the dashboard SHALL display the metric trace in
its meaningful units and SHALL render the available hourly baseline as a
distribution ribbon. The ribbon SHALL represent the baseline distribution for
the time of day. With multiple metrics selected, normalized traces SHALL remain
readable without implying that their actual units are the same.

#### Scenario: Inspect a metric against its expected range

- **WHEN** a single metric and its baseline are available
- **THEN** the dashboard displays the trace with the corresponding baseline
  distribution for the visible time range

### Requirement: Filter event markers by event group

The dashboard SHALL let users show or hide event markers by event group. The
groups SHALL cover connection/authentication, RF/capacity, device lifecycle,
configuration, security, and AI events. Event markers SHALL correspond to
events in the currently loaded time range, and group labels SHALL reflect the
count of matching events in that range.

#### Scenario: Show a selected event group

- **WHEN** a user enables an event group
- **THEN** the dashboard displays markers for matching events in the loaded
  time range

#### Scenario: Hide a selected event group

- **WHEN** a user disables an event group
- **THEN** markers for that group's event types are removed from the chart

### Requirement: Inspect chart values and events

The dashboard SHALL support pointer inspection of chart data. Metric hover
details SHALL show the visible metrics' values at the cursor time and identify
the active metric with its available classifier breakdown. Event marker details
SHALL show the event type and message, the entity when present, and the count
when multiple events occur within one second.

#### Scenario: Inspect metric values at a point in time

- **WHEN** a user hovers over the plot away from the live edge
- **THEN** the dashboard shows a time crosshair and values for the visible
  metrics at that time

#### Scenario: Inspect an event marker

- **WHEN** a user hovers over an event marker
- **THEN** the dashboard shows the event type, message, entity when present,
  and co-timed event count without replacing the event details with the metric
  trace tooltip

### Requirement: Show live connection state and recover metric gaps

The dashboard SHALL show whether its live WebSocket connection is connected or
disconnected. After a disconnection it SHALL attempt to reconnect. When the
connection resumes, it SHALL request recent history for enabled metrics to
recover metric data missed during the gap.

#### Scenario: Lose and regain the live connection

- **WHEN** the live connection drops and later reconnects
- **THEN** the dashboard updates its connection status, resumes live updates,
  and reloads recent metric history for enabled metrics

### Requirement: Keep the chart usable as the viewport changes

The dashboard SHALL resize the chart to fit its container when the browser
viewport changes, while preserving the selected metrics and time range.

#### Scenario: Resize the browser

- **WHEN** the browser viewport changes size
- **THEN** the chart redraws to fit its container and continues to represent the
  selected data and range
