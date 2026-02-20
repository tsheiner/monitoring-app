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

**Goal**
- Add vertical/horizontal crosshair and nearest-metric computation at cursor position.

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

**Goal**
- Show per-metric values in tooltip and expand classifier rows only for active metric with debounce/hysteresis.

**Files**
- `frontend/src/chart/ChartView.ts`
- `frontend/src/main.ts`
- `frontend/index.html` (if tooltip host element is needed)

**Write tests first**
- `test_tooltip_lists_all_visible_metrics_at_cursor_time`
- `test_only_active_metric_expands_classifier_rows`
- `test_active_metric_switches_only_after_hysteresis_window`
- `test_transient_nearest_metric_changes_do_not_flip_active_metric`

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

## Agent Todo Template (Copy/Paste)

Use this directly as an internal todo state.

```json
{
  "epic": "classifier-architecture",
  "current_task": "FD-016",
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
    {"id":"FD-016","status":"pending","depends_on":["FD-015"]},
    {"id":"FD-017","status":"pending","depends_on":["FD-016"]},
    {"id":"FD-018","status":"pending","depends_on":["FD-017"]},
    {"id":"FD-019","status":"pending","depends_on":["FD-016","FD-017","FD-018"]}
  ]
}
```

## Validation Checklist (must pass before marking epic done)

- Classifier pool is shared across metrics where domain semantics require.
- Perturbations use flat shared classifier keys (e.g., `dhcp`), not metric-qualified keys.
- Perturbations target classifiers, not retired drivers.
- Bootstrap artifact includes classifier distributions and thresholds.
- API and WS expose optional classifier payloads.
- Legacy consumers still work when `classifiers` is absent.
- E2E tests verify top contributor attribution for representative events.
- Crosshair shows vertical + horizontal hairlines while hovering in plot area.
- Tooltip lists all visible metrics at cursor time; only active metric expands classifier rows.
- Active metric swap uses hysteresis and avoids transient rapid cycling.
- Pan suppresses crosshair/tooltip; live-edge behavior matches selected suppression/freeze policy.

