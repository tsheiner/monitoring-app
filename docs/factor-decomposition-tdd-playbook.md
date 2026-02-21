# Classifier Architecture TDD Playbook (Agent Portable)

## Purpose

Portable implementation guide for the classifier architecture design in `docs/factor-decomposition-plan.md`.

This document is optimized for coding agents that need:
- A deterministic execution order
- Test-first guardrails
- A task list they can convert into internal todos
- Clear done criteria per step

## How to Use This Document

- Execute tasks in task ID order unless a dependency says otherwise.
- For each task: write tests first, run them red, implement minimal code, run green.
- Do not start a dependent task until all prerequisite tasks are green.
- Keep compatibility requirements in scope:
  - Existing API consumers must continue to work.
  - `classifiers` remains optional in observation models.

## Global Constraints

- Keep `client_load` as the only environmental condition.
- Retire abstract shared drivers `rf_quality` and `infra_health`.
- Classifiers are simulation primitives; metrics are derived consequences.
- Classifier thresholds must be derived from bootstrap output, not config constants.
- Preserve current metric list and metric-level daily profile behavior.
- Keep left sidebar behavior unchanged; classifier detail is surfaced via chart tooltip only.

## Execution Graph

| Phase | Task IDs | Depends On |
|---|---|---|
| A. Foundations | FD-001, FD-002 | none |
| B. Classifier Engine | FD-003a, FD-003b, FD-004, FD-005 | A |
| C. Perturbations | FD-006, FD-007 | B |
| D. Bootstrap/Baselines | FD-008, FD-009 | B, C |
| E. Models/Storage/API | FD-010, FD-011, FD-012 | D |
| F. Realtime/Acceptance | FD-013, FD-014 | E |
| G. UI Crosshair/Tooltip | FD-015, FD-016, FD-017, FD-018 | E (FD-011 minimum) |
| H. UI Acceptance | FD-019 | G |
| I. Data-flow Fixes | FD-020, FD-021 | E |
| J. Visual Polish | FD-022, FD-023, FD-024, FD-025 | G, I |
| K. Final Acceptance | FD-026 | J |

---

## Task Catalog

### FD-001 - Add backend test harness

**Goal**
- Establish consistent backend test execution for TDD workflow.

**Files**
- `backend/requirements.txt` (if pytest deps are missing)
- `backend/tests/` (new test tree)

**Write tests first**
- Smoke test that imports generator and API model modules.

**Implement**
1. Add pytest dependencies if absent.
2. Create `backend/tests/` structure with `__init__.py` as needed.
3. Add common fixtures for deterministic seed and temp data directory.

**Done when**
- `pytest` runs and discovers test modules successfully.

---

### FD-002 - Add deterministic test fixtures

**Goal**
- Make generator/bootstrap tests reproducible and fast.

**Files**
- `backend/tests/conftest.py`

**Write tests first**
- Fixture unit tests confirming:
  - fixed timestamps
  - isolated temp DB/data paths
  - no shared singleton leakage between tests

**Implement**
1. Add fixture for seeded generator initialization.
2. Add fixture to reset singleton stores/generators between tests.
3. Add fixture that writes temp `data/` and cleans up.

**Done when**
- Re-running tests yields identical values for deterministic scenarios.

---

### FD-003a - Introduce classifier domain model additively (non-breaking)

**Goal**
- Load classifier pool + per-metric classifier mapping without removing existing driver path yet.

**Files**
- `backend/simulator/realistic_generator.py`
- `backend/simulator/config.json`
- `backend/simulator/config_enterprise.json`
- `backend/simulator/config_campus.json`
- `backend/simulator/config_hospital.json`

**Write tests first**
- `test_classifier_pool_contains_shared_classifiers`
- `test_metric_classifier_mapping_weights_sum_reasonably` (for sanity, not strict 1.0 unless chosen)
- `test_unknown_classifier_reference_raises`

**Implement**
1. Add top-level classifier definitions loader from config.
2. Add per-metric classifier references/weights loader.
3. Validate all referenced classifiers exist.
4. Keep existing driver path intact behind a compatibility switch/branch for now.

**Done when**
- Generator initializes with classifier definitions enabled and legacy path still passing tests.

---

### FD-003b - Remove retired shared drivers (breaking cleanup)

**Goal**
- Remove retired driver infrastructure after additive classifier path is stable.

**Files**
- `backend/simulator/realistic_generator.py`
- `backend/simulator/config*.json`

**Write tests first**
- `test_generator_no_longer_requires_rf_quality_or_infra_health`
- `test_client_load_remains_environmental_condition`

**Implement**
1. Remove `rf_quality` and `infra_health` driver dependencies.
2. Keep `client_load` environmental behavior.
3. Delete dead constants/methods/state tied to retired drivers.

**Done when**
- Generator runs entirely on classifier primitives + `client_load` without legacy shared drivers.

---

### FD-004 - Implement classifier OU processes and metric derivation

**Goal**
- Move stochastic source from per-metric OU noise to shared classifier OU processes.

**Files**
- `backend/simulator/realistic_generator.py`

**Write tests first**
- `test_classifier_ou_updates_over_time`
- `test_metric_derivation_matches_formula`
- `test_shared_classifier_changes_multiple_metrics`

**Implement**
1. Add per-entity classifier state map and update loop.
2. Compute per-metric value from:
   - metric daily profile
   - weighted classifier deviation term
3. Keep clipping to metric min/max.

**Done when**
- Metric value is derived from classifiers and daily profile with deterministic unit-test parity.

---

### FD-005 - Emit classifier breakdown in observations

**Goal**
- Include classifier-level decomposition in generated observations.

**Files**
- `backend/simulator/realistic_generator.py`

**Write tests first**
- `test_observation_includes_classifiers_field`
- `test_classifier_contains_value_status_contribution_weight`
- `test_primary_contributor_is_max_weighted_deviation`

**Implement**
1. Compute classifier contribution in metric units (signed).
2. Compute classifier status using thresholds (placeholder until FD-009 if needed).
3. Add optional `classifiers` payload to generated observation dict.

**Done when**
- Every generated observation can include classifier breakdown data.

**Important test boundary**
- In FD-005, assert `status` field presence/shape only.
- Do not assert correctness of `green/yellow/red` values until FD-009 is complete.

---

### FD-006 - Retarget perturbations to classifiers

**Goal**
- Change perturbation system from driver keys to classifier keys.

**Files**
- `backend/simulator/perturbations.py`

**Write tests first**
- `test_perturbation_effect_at_classifier_key`
- `test_total_effect_filters_by_entity`
- `test_old_driver_templates_not_used`
- `test_dot_notation_classifier_keys_rejected_or_normalized`

**Implement**
1. Rename `affected_metrics` to `affected_classifiers` in model/template code.
2. Enforce shared flat classifier names (e.g., `dhcp`, not `successful_connects.dhcp`).
3. Update manager aggregation to resolve classifier effects.
4. Preserve decay semantics.

**Done when**
- Perturbation manager applies effects to classifiers only.

---

### FD-007 - Update event templates and event generator mapping

**Goal**
- Align event vocabulary and perturbation linkage with classifier architecture.

**Files**
- `backend/simulator/event_generator.py`
- `backend/simulator/perturbations.py`

**Write tests first**
- `test_dhcp_overload_affects_expected_classifiers`
- `test_radius_timeout_affects_auth_classifiers`
- `test_single_event_cascades_to_dependent_metrics`

**Implement**
1. Add revised event templates from plan.
2. Ensure `create_perturbation_from_event()` creates classifier-targeted perturbations.
3. Keep severity/message metadata behavior intact.

**Done when**
- Event -> perturbation -> classifier -> metric chain is operational.

---

### FD-008 - Bootstrap classifier distributions

**Goal**
- Bootstrap stores hourly classifier distributions alongside metric distributions.

**Files**
- `backend/simulator/bootstrap.py`

**Write tests first**
- `test_bootstrap_collects_classifier_timeseries`
- `test_baselines_json_contains_classifier_distributions`

**Implement**
1. Track classifier values during clean bootstrap generation.
2. Aggregate by hour-of-day similarly to metric baseline logic.
3. Persist in `data/baselines.json` under a classifier-specific section.

**Done when**
- Baselines file includes both metric and classifier distribution blocks.

---

### FD-009 - Derive classifier thresholds from bootstrap

**Goal**
- Derive `green/yellow/red` thresholds from observed bootstrap percentiles.

**Files**
- `backend/simulator/bootstrap.py`
- `backend/simulator/realistic_generator.py`

**Write tests first**
- `test_thresholds_come_from_baseline_percentiles`
- `test_status_classification_green_yellow_red`
- `test_changing_ou_sigma_changes_derived_thresholds`
- `test_changing_bootstrap_window_changes_derived_thresholds`

**Implement**
1. Compute threshold cutoffs from classifier distributions (per agreed percentile policy).
2. Persist thresholds in baseline artifact.
3. Load/apply thresholds in generator status computation.

**Done when**
- Status classification uses bootstrap-derived thresholds only.

---

### FD-010 - Extend server models and storage for classifiers

**Goal**
- Add typed classifier model and optional classifiers in observations, with backward compatibility.

**Files**
- `backend/server/models.py`
- `backend/storage/metrics_store.py`

**Write tests first**
- `test_metric_observation_accepts_optional_classifiers`
- `test_storage_roundtrip_with_classifiers`
- `test_storage_roundtrip_without_classifiers`
- `test_storage_strategy_selected_and_documented`

**Implement**
1. Add `ClassifierStatus` model.
2. Extend `MetricObservation` with optional `classifiers`.
3. Choose and implement one storage strategy:
   - A: keep TinyFlux CSV and store `classifiers` as escaped JSON column/field, or
   - B: keep TinyFlux for scalar metric value and add sidecar SQLite/table keyed by `(timestamp, metric, entity)` for classifier payload, or
   - C: migrate metric observations storage to SQLite with JSON field support.
4. Record strategy decision in code comments and `docs/decisions.md` (new ADR or extension note).
5. Store/retrieve classifiers payload without breaking existing rows.

**Done when**
- Old rows deserialize, new rows preserve classifier payload, and chosen storage strategy is explicitly documented.

---

### FD-011 - Expose classifier payloads in metric query APIs

**Goal**
- Include classifier decomposition data in metric observation API responses.

**Files**
- `backend/server/http_api.py`
- `backend/server/models.py`

**Write tests first**
- `test_get_metric_returns_classifiers_when_present`
- `test_get_metric_still_works_when_classifiers_missing`

**Implement**
1. Ensure API response models can serialize classifier payload.
2. Keep current endpoint behavior and query params unchanged.

**Done when**
- `/api/metrics/{metric}` returns observations with optional `classifiers`.

---

### FD-012 - Add classifier-specific API endpoints

**Goal**
- Provide endpoints for current classifier state and classifier baselines.

**Files**
- `backend/server/http_api.py`
- `backend/server/models.py`

**Write tests first**
- `test_get_metric_classifiers_current_state`
- `test_get_metric_classifier_baseline`
- `test_invalid_metric_returns_404`

**Implement**
1. Add endpoint for current classifiers of a metric.
2. Add endpoint for classifier baseline distributions.
3. Reuse baseline artifact as source of truth.

**Done when**
- Consumers can request classifier state and baseline data independently.

---

### FD-013 - Include classifiers in realtime WebSocket metric messages

**Goal**
- Realtime stream includes classifier payload in metric observations.

**Files**
- `backend/server/websocket_server.py`
- `backend/main.py`

**Write tests first**
- `test_websocket_metric_message_includes_classifiers`
- `test_websocket_message_shape_backward_compatible`

**Implement**
1. Broadcast observation dict including optional `classifiers`.
2. Ensure no change to event message shape.

**Done when**
- WS metric messages carry classifier decomposition when available.

---

### FD-014 - End-to-end acceptance scenarios

**Goal**
- Validate causal decomposition behavior matches assurance-style UX intent.

**Files**
- `backend/tests/e2e/` (new)

**Write tests first**
- `test_dhcp_overload_primary_contributor_for_connect_metrics`
- `test_interference_event_multimetric_degradation`
- `test_steady_state_classifiers_mostly_green`

**Implement**
1. Drive deterministic events through generator.
2. Assert top contributor and status transitions.
3. Assert cross-metric impact from shared classifiers.

**Done when**
- E2E tests prove causal attribution and contributor ranking behavior.

---

### FD-015 - Add frontend test harness for chart interactions

**Goal**
- Establish frontend TDD capability for hover/crosshair/tooltip behavior.

**Files**
- `frontend/package.json`
- frontend test config/setup files (new)

**Write tests first**
- `test_chart_surface_mounts_for_hover_tests`
- `test_mousemove_can_be_simulated_with_deterministic_time`

**Implement**
1. Add frontend test tooling compatible with Vite + TypeScript.
2. Add deterministic timer controls for hysteresis tests.
3. Add fixture data with multiple visible metrics and classifier payloads.

**Done when**
- Frontend tests run locally/CI and can simulate hover interactions.

---

### FD-016 - Implement crosshair and nearest-metric detection

**Status: ⚠️ PARTIAL — see FD-022 for visual remediation**

**Goal**
- Add vertical crosshair and nearest-metric computation at cursor position.

**What was implemented**
- Vertical AND horizontal dashed crosshair lines (both incorrect per spec)
- Nearest-metric detection by cursor y proximity
- Observation typing for classifier payload

**What remains (deferred to FD-022)**
- Crosshair should be vertical only (no horizontal line), solid not dashed
- Highlighted dots on metric traces at crosshair x position

**Files**
- `frontend/src/chart/ChartView.ts`
- `frontend/src/chart/types.ts`

**Write tests first**
- `test_crosshair_lines_render_on_hover_inside_plot`
- `test_crosshair_hides_on_mouseleave`
- `test_nearest_metric_selection_by_cursor_y_at_time_x`

**Implement**
1. Render vertical crosshair at cursor x and horizontal hairline at cursor y.
2. Compute nearest metric using current cursor coordinate against rendered series.
3. Extend observation typing so classifier payload is available to tooltip logic.

**Done when**
- Crosshair and nearest-metric computation are deterministic and test-covered.

---

### FD-017 - Implement tooltip content + active-metric hysteresis

**Status: ⚠️ PARTIAL — see FD-023, FD-024, FD-025 for visual remediation**

**Goal**
- Show per-metric values in tooltip and expand classifier rows only for active metric with debounce/hysteresis.

**What was implemented**
- Basic tooltip listing all visible metrics with name + value
- Classifier row expansion for active metric (rendering code exists)
- Hysteresis window (~150ms) before active metric swap
- Primary classifier highlighting (bold, worst status)

**What remains (deferred to FD-023, FD-024, FD-025)**
- Tooltip missing timestamp header row
- Metric state icons (positive/warning/degraded) not implemented — only colored dots
- Metric labels use raw keys (`time_to_connect`) instead of display labels ("Time to Connect")
- Values shown without units (e.g., "36.34" instead of "40.5s")
- Classifier data never reaches tooltip due to data-flow gaps (see FD-020, FD-021)

**Files**
- `frontend/src/chart/ChartView.ts`
- `frontend/src/main.ts`
- `frontend/index.html` (if tooltip host element is needed)

**Write tests first**
- `test_tooltip_lists_all_visible_metrics_at_cursor_time`
- `test_only_active_metric_expands_classifier_rows`
- `test_active_metric_switches_only_after_hysteresis_window`
- `test_transient_nfd-018, 019 completeearest_metric_changes_do_not_flip_active_metric`

**Implement**
1. Build tooltip model with all visible metrics (name + value).
2. Expand classifier rows for active metric only (name, value, status).
3. Add hysteresis window (~150ms) before active metric swap.
4. Highlight primary classifier (worst status, tie-break by `|weight*deviation|`).

**Done when**
- Tooltip behavior is stable and avoids rapid cycling when metric lines are close.

---

### FD-018 - Interaction state handling (hover, pan, live edge)

**Goal**
- Enforce interaction state rules for hover, pan drag, and live-edge suppression/freeze.

**Files**
- `frontend/src/chart/ChartView.ts`
- `frontend/src/main.ts`

**Write tests first**
- `test_pan_drag_suppresses_crosshair_and_tooltip`
- `test_hover_recovers_after_pan_end`
- `test_live_edge_region_suppresses_or_freezes_tooltip`

**Implement**
1. Suppress tooltip/crosshair while panning.
2. Restore hover affordances after drag completes.
3. Apply chosen live-edge policy for streaming right-edge region.

**Done when**
- Hover/pan/live-edge behavior matches the updated plan.

---

### FD-019 - UI acceptance tests for crosshair tooltip workflow

**Goal**
- Validate complete classifier tooltip UX with stable active-metric behavior.

**Files**
- frontend UI/e2e test suite

**Write tests first**
- `test_hover_shows_crosshair_and_tooltip`
- `test_deliberate_cursor_reposition_changes_active_metric`
- `test_brief_cursor_pass_near_other_line_does_not_swap_active_metric`
- `test_sidebar_behavior_unchanged_while_tooltip_updates`

**Implement**
1. Add deterministic scenario with closely spaced metric lines to exercise hysteresis.
2. Assert classifier rows/status indicator rendering for active metric.
3. Verify sidebar remains unchanged.

**Done when**
- UI acceptance tests prove crosshair/tooltip behavior and classifier expansion logic.

---

### FD-020 - Fix HTTP API classifier data flow

**Goal**
- Ensure classifier data is included in metric observations returned by the HTTP API, especially in the aggregated (`_aggregated`) entity path.

**Files**
- `backend/server/http_api.py`
- `backend/server/models.py` (verify)

**Write tests first**
- `test_aggregated_observations_include_classifiers`
- `test_classifier_api_endpoints_accessible`
- `test_classifier_baseline_endpoint_returns_data`

**Implement**
1. In `query_metric()`, when `entity="_aggregated"`, the aggregation loop creates new observation dicts with only `timestamp`, `metric`, `value`, `entity`. Fix this to also aggregate classifiers across APs:
   - Collect classifier data from all observations at each timestamp
   - Average classifier values across APs
   - Derive status from the averaged value using the same threshold logic
   - Include aggregated `classifiers` in the response observations
2. Verify `/api/metrics/{metric}/classifiers/current` and `/api/classifiers/{classifier}/baseline` routes are accessible after server restart. If still 404, check FastAPI route ordering — `/api/metrics/{metric}` may shadow longer paths if defined first.
3. Verify the `MetricObservation` model serializes classifiers correctly (it already has the field; confirm with a real response).

**Done when**
- `curl "http://localhost:5011/api/metrics/time_to_connect?start=...&end=..."` returns observations with `classifiers` arrays
- `/api/metrics/{metric}/classifiers/current` returns current classifier state
- `/api/classifiers/{classifier}/baseline` returns hourly distributions

---

### FD-021 - Fix frontend classifier data flow (WS + HTTP)

**Goal**
- Ensure classifier data flows from backend through WebSocket and HTTP responses into the chart's observation data, so the tooltip can render classifiers.

**Files**
- `frontend/src/chart/types.ts`
- `frontend/src/api/client.ts`
- `frontend/src/main.ts`
- `frontend/src/chart/ChartView.ts`

**Write tests first**
- `test_metric_message_type_includes_classifiers`
- `test_ws_message_classifiers_passed_to_chart`
- `test_http_observations_classifiers_passed_to_chart`

**Implement**
1. In `types.ts`, add `classifiers?: Record<string, ClassifierValue>` to `MetricMessage` interface.
2. In `main.ts` `setupAPICallbacks()`, change the `onMetric` handler to pass classifiers from the WS message:
   ```typescript
   this.chart.appendLiveData(message.metric, {
     timestamp: message.timestamp,
     value: message.value,
     classifiers: message.classifiers,  // NEW: pass through
   });
   ```
3. In `main.ts`, verify that HTTP-fetched observations (from `fetchMetricHistory`) also thread classifiers through to `chart.loadTimeSeries()`. The `MetricResponse.observations` should already include classifiers if FD-020 is done; confirm the chart receives them.
4. In `client.ts`, no code change needed — `JSON.parse` already captures all fields. Just confirm `MetricMessage` type is updated.

**Done when**
- When hovering over the chart with a single metric active, the tooltip shows classifier rows for the active metric (requires FD-020 + this task).
- `Observation` objects stored in `DataTarget` include `classifiers` field when available.

---

### FD-022 - Vertical indicator visual spec (solid line + highlighted dots)

**Goal**
- Make the vertical indicator match the visual spec: solid vertical line (no horizontal), with highlighted dots on each visible metric trace at the cursor's x position.

**Files**
- `frontend/src/chart/ChartView.ts`

**Write tests first**
- `test_crosshair_vertical_line_is_solid_not_dashed`
- `test_no_horizontal_crosshair_line`
- `test_highlighted_dots_rendered_at_trace_intersections`
- `test_highlighted_dot_color_matches_metric_color`

**Visual specification** (agent must implement to match these exact expectations):

1. **Remove the horizontal crosshair line entirely**:
   - Delete `crosshairHorizontal` element creation and all references
   - Only `crosshairVertical` should exist
2. **Change vertical line to solid**:
   - Remove `.attr("stroke-dasharray", "4 4")` from `crosshairVertical`
   - Keep stroke color `#888` and width 1px
3. **Add highlighted dots at metric-trace intersections**:
   - For each visible metric, find the observation nearest to cursor time
   - Compute the Y pixel position of that observation's value
   - Render a filled circle (SVG `<circle>`) at `(cursorX, obsY)`:
     - `r` = 4 (radius 4px)
     - `fill` = the metric's trace color
     - `stroke` = none (or same color)
   - Store dot elements in the crosshair group so they hide/show together
   - On each `updateCrosshair` call, reposition or recreate dots for all visible metrics
   - When crosshair hides, dots hide too

**Implementation guidance**:
- In the constructor, create a `crosshairDots` container `<g>` inside `crosshairGroup`
- In `updateCrosshair()`, after computing cursor time:
  - For each entry in `this.metrics`, find the closest observation to cursor time
  - Compute `yPixel = yScale(obs.value)` (or normalized equivalent for multi-metric)
  - Update or create `<circle>` elements inside `crosshairDots` for each metric
  - `d3.selectAll` approach: bind data, enter/update/exit pattern on the dots
- Store references to avoid DOM churn on every mousemove

**Done when**
- Hovering shows a solid vertical line with colored dots on every visible trace — visually matching the reference screenshots.

---

### FD-023 - Tooltip timestamp header and display label formatting

**Goal**
- Add a timestamp header to the tooltip and use human-readable metric display labels instead of raw keys.

**Files**
- `frontend/src/chart/ChartView.ts`
- `frontend/src/main.ts`

**Write tests first**
- `test_tooltip_shows_timestamp_header`
- `test_tooltip_uses_display_labels_not_raw_keys`
- `test_tooltip_timestamp_format_matches_spec`

**Visual specification**:

1. **Timestamp header**:
   - First line of tooltip content must be a formatted date-time string
   - Format: `ddd MMM DD HH:mm` (e.g., "Mon Nov 10 23:48")
   - Derive from cursor's x position: `xScale.invert(x)` → Date → format
   - Style: slightly lighter weight than metric rows, serves as a header
   - HTML: `<div style="margin-bottom: 8px; opacity: 0.8; font-size: 12px;">Mon Nov 10 23:48</div>`
2. **Metric display labels**:
   - Replace raw metric keys with human-readable labels in tooltip
   - Mapping: `time_to_connect` → "Time to Connect", `throughput` → "Throughput", `coverage` → "Coverage", `capacity` → "Capacity", `roaming` → "Roaming", `successful_connects` → "Successful Connects", `ap_health` → "AP Health"
   - The label mapping should be accessible to `ChartView` — either passed in via constructor config, or stored as a static map, or retrieved from `MetricData`

**Implementation guidance**:
- The `MetricInfo` type in `main.ts` already has `name` and `label` fields. Pass the label along when adding metrics to the chart (e.g., `chart.addMetric(name, color, label)`) or store a name→label map in `ChartView`.
- In `buildTooltipContent()`:
  - Add timestamp formatting at the top. Use `Date` constructor with cursor time * 1000, then format with weekday abbreviation + month abbreviation + day + time.
  - Replace `metric.name` in the display with the label.

**Done when**
- Tooltip shows timestamp at top (e.g., "Sat Feb 21 10:42") and metrics show display labels.

---

### FD-024 - Tooltip metric state icons (positive/warning/degraded)

**Goal**
- Show health-aware state icons for each metric row in the tooltip, derived from the metric's baseline distribution.

**Files**
- `frontend/src/chart/ChartView.ts`

**Write tests first**
- `test_tooltip_metric_shows_green_icon_when_within_range`
- `test_tooltip_metric_shows_yellow_icon_when_edge_of_range`
- `test_tooltip_metric_shows_red_icon_when_out_of_range`

**Visual specification**:

Each metric row's leading icon indicates the metric's health at the tooltip's time position. The icon is NOT just the metric's color — it reflects the metric's status relative to its baseline distribution.

1. **State classification logic**:
   - Look up the metric's `BaselineResponse` (already loaded per metric in `MetricData.baseline`)
   - Find the hourly distribution for the current hour (from `hourly_distributions`)
   - Compare the metric's value at cursor time against the distribution percentiles:
     - **Green (positive)**: value between `p10` and `p90`
     - **Yellow (warning)**: value between `p5`–`p10` OR `p90`–`p95`
     - **Red (degraded)**: value below `p5` OR above `p95`
   - If no baseline data is available, default to showing the metric's color dot (current behavior)

2. **Icon rendering**:
   - **Green/positive**: `<span style="color: #4caf50;">●</span>` — green filled circle (same as current green classifier dot)
   - **Yellow/warning**: `<span style="color: #ff9800;">⚠</span>` — amber warning triangle
   - **Red/degraded**: `<span style="color: #f44336;">●</span>` — red filled circle
   - Icon replaces the current colored dot that just matches the metric color
   - The icon comes BEFORE the metric label

3. **Same icons for classifier rows**: The classifier rows in the active metric section already use green/yellow/red dots. Keep that but ensure consistency: green ●, yellow ⚠, red ● (matching the metric-level icon style).

**Implementation guidance**:
- Add a method `getMetricStatus(metricName: string, value: number, cursorTime: number): 'green' | 'yellow' | 'red'` to `ChartView`:
  - Finds the `MetricData` for the metric
  - Gets the baseline and current hour from the cursor timestamp
  - Finds the matching hourly distribution entry
  - Compares value against percentile bands
  - Returns the status string
- In `buildTooltipContent()`, call this method for each metric to determine the icon

**Done when**
- Metrics in tooltip show health-aware icons: green ● for normal, ⚠ for warning, red ● for degraded — determined from baseline bands.

---

### FD-025 - Tooltip value units

**Goal**
- Display metric values in the tooltip with appropriate unit suffixes.

**Files**
- `frontend/src/chart/ChartView.ts`
- `frontend/src/main.ts` (if units are passed during metric registration)

**Write tests first**
- `test_tooltip_time_to_connect_shows_seconds_unit`
- `test_tooltip_throughput_shows_units_suffix`
- `test_tooltip_percentage_metrics_show_percent`

**Visual specification**:

| Metric | Unit suffix | Example |
|--------|-----------|---------|
| time_to_connect | "s" | "40.5s" |
| throughput | " Mbps" | "450 Mbps" |
| coverage | "%" | "92.3%" |
| capacity | "%" | "78.1%" |
| roaming | " ms" | "12 ms" |
| successful_connects | "%" | "97.5%" |
| ap_health | "%" | "95.2%" |

**Implementation guidance**:
- Store a `units` map in `ChartView` or pass units when adding metrics
- In `buildTooltipContent()`, look up the unit for each metric and append to the formatted value
- Use appropriate decimal precision:
  - Seconds: 1 decimal place (e.g., "40.5s")
  - Percentages: 1 decimal place (e.g., "92.3%")
  - Throughput: 0 decimal places (e.g., "450 Mbps")
  - Milliseconds: 0 decimal places (e.g., "12 ms")

**Done when**
- Every metric value in the tooltip includes its unit suffix.

---

### FD-026 - Visual acceptance: End-to-end tooltip verification

**Goal**
- Validate the complete tooltip experience matches reference screenshots using Playwright MCP.

**Files**
- Frontend test suite / manual Playwright verification

**Verification steps** (must be performed with Playwright MCP per project instructions):
1. Start backend and frontend servers
2. Navigate to `http://localhost:5012`
3. With one metric active (Time to Connect):
   - Hover over chart area
   - Verify: solid vertical line, no horizontal line
   - Verify: colored dot on the Time to Connect trace at hover x
   - Verify: tooltip shows timestamp header (e.g., "Sat Feb 21 10:42")
   - Verify: tooltip shows metric state icon (green/yellow/red, not just orange dot)
   - Verify: tooltip shows "Time to Connect" (not "time_to_connect")
   - Verify: tooltip shows value with unit (e.g., "36.1s")
   - Verify: tooltip shows classifier breakdown for the active metric (Association, Authorization, DHCP, DNS with status dots and values)
4. Enable a second metric (Throughput):
   - Hover over chart
   - Verify: two highlighted dots (orange + blue) on traces
   - Verify: both metrics shown in tooltip with state icons and display labels
   - Verify: only the nearest metric shows classifier breakdown
   - Move cursor closer to the other metric and wait 200ms
   - Verify: active metric switches (hysteresis)
5. Verify pan suppression: click-drag to pan, confirm tooltip disappears during drag

**Done when**
- All verification steps pass via Playwright MCP snapshot and screenshot inspection.

---

Use this directly as an internal todo state.

```json
{
  "epic": "classifier-architecture",
  "current_task": "FD-020",
  "tasks": [
    {"id":"FD-001","status":"done","depends_on":[]},
    {"id":"FD-002","status":"done","depends_on":["FD-001"]},
    {"id":"FD-003a","status":"done","depends_on":["FD-001","FD-002"]},
    {"id":"FD-003b","status":"done","depends_on":["FD-003a"]},
    {"id":"FD-004","status":"done","depends_on":["FD-003b"]},
    {"id":"FD-005","status":"done","depends_on":["FD-004"]},
    {"id":"FD-006","status":"done","depends_on":["FD-004"]},
    {"id":"FD-007","status":"done","depends_on":["FD-006"]},
    {"id":"FD-008","status":"done","depends_on":["FD-004","FD-007"]},
    {"id":"FD-009","status":"done","depends_on":["FD-008"]},
    {"id":"FD-010","status":"done","depends_on":["FD-005","FD-009"]},
    {"id":"FD-011","status":"done","depends_on":["FD-010"]},
    {"id":"FD-012","status":"done","depends_on":["FD-009","FD-010"]},
    {"id":"FD-013","status":"done","depends_on":["FD-010"]},
    {"id":"FD-014","status":"done","depends_on":["FD-011","FD-012","FD-013"]},
    {"id":"FD-015","status":"done","depends_on":["FD-011"]},
    {"id":"FD-016","status":"partial","depends_on":["FD-015"],"note":"visual defects: see FD-022"},
    {"id":"FD-017","status":"partial","depends_on":["FD-016"],"note":"visual + data defects: see FD-023/024/025"},
    {"id":"FD-018","status":"done","depends_on":["FD-017"]},
    {"id":"FD-019","status":"done","depends_on":["FD-016","FD-017","FD-018"],"note":"tests written but visual spec was incomplete"},
    {"id":"FD-020","status":"todo","depends_on":["FD-011"]},
    {"id":"FD-021","status":"todo","depends_on":["FD-020"]},
    {"id":"FD-022","status":"todo","depends_on":["FD-016"]},
    {"id":"FD-023","status":"todo","depends_on":["FD-017"]},
    {"id":"FD-024","status":"todo","depends_on":["FD-017"]},
    {"id":"FD-025","status":"todo","depends_on":["FD-017"]},
    {"id":"FD-026","status":"todo","depends_on":["FD-020","FD-021","FD-022","FD-023","FD-024","FD-025"]}
  ]
}
```

## Validation Checklist (must pass before marking epic done)

- Classifier pool is shared across metrics where domain semantics require.
- Perturbations use flat shared classifier keys (e.g., `dhcp`), not metric-qualified keys.
- Perturbations target classifiers, not retired drivers.
- Bootstrap artifact includes classifier distributions and thresholds.
- API and WS expose optional classifier payloads.
- HTTP API `/api/metrics/{metric}` returns classifiers in observations (including `_aggregated` entity path).
- Legacy consumers still work when `classifiers` is absent.
- E2E tests verify top contributor attribution for representative events.
- Vertical indicator is a solid line (not dashed), no horizontal line.
- Highlighted dots appear on each visible metric trace at the cursor's time x position.
- Tooltip shows a timestamp header (formatted date-time).
- Tooltip metric rows show health-aware state icons (green ●, yellow ⚠, red ●) derived from baseline percentiles.
- Tooltip uses human-readable metric labels (e.g., "Time to Connect"), not raw keys.
- Tooltip shows metric values with unit suffixes (e.g., "40.5s", "450 Mbps").
- Tooltip lists all visible metrics; only active metric expands classifier rows.
- Classifier rows show state icon + name + value.
- Active metric swap uses hysteresis and avoids transient rapid cycling.
- Pan suppresses vertical indicator/tooltip; live-edge behavior matches selected suppression/freeze policy.
- All items verified with Playwright MCP (FD-026).

