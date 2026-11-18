# Proposal

## Why

Selecting one metric and comparing several metrics use different
click gestures. Visible guidance in the Metrics panel will help
users discover both interactions.

## What Changes

- Add an always-visible note beneath the Metrics heading:
  “Click a metric to inspect it. Shift-click to compare metrics.”
- Style the note as readable secondary text that wraps within
  the sidebar.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `network-monitoring-ui`: Require visible guidance explaining
  how to select a metric and compare multiple metrics.

## Impact

- Frontend HTML and CSS for the Metrics panel.
- The network-monitoring-ui specification.
