# Spec Delta

## ADDED Requirements

### Requirement: Explain metric selection

The dashboard SHALL display a readable, always-visible note
beneath the Metrics heading explaining how to select one metric
and compare multiple metrics.

#### Scenario: Discover metric selection controls

- **WHEN** the Metrics panel is displayed
- **THEN** a note beneath its heading reads:
  “Click a metric to inspect it. Shift-click to compare metrics.”

#### Scenario: Read guidance within the Metrics panel

- **WHEN** the note is displayed in the existing Metrics panel
- **THEN** its full text is visible within the panel,
  wrapping onto additional lines as needed
- **AND** it does not overlap the metric controls
- **AND** displaying the note does not increase the Metrics
  panel’s width compared with the same panel without the note
  at the same viewport
