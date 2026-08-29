# Public health indicators and private simulation diagnostics

## Status and purpose

This plan establishes an explicit public observability contract before the
incident-run and remediation work changes the simulator's behavior. It resolves
a conceptual mismatch in the current product: the dashboard exposes internal
`classifier` values as if they were operational evidence, while the planned
monitor-facing API correctly must not reveal the model that drives the
simulation.

The desired outcome is not a less explainable dashboard. It is a credible one:
monitoring clients and the normal dashboard receive meaningful network-health
indicators, while simulator-specific state remains available only to an
authorized operator/debug surface.

This document is deliberately a plan, not an assertion that the current UI has
been validated with network operators. The current display is input to the
audit below, not the source of truth for the resulting public catalog.

## Decision

Use three distinct layers:

```text
private simulation state
        ↓ derived/mapped by a versioned contract
public network-health indicators
        ↓ contextual evidence for
public network metrics and overall health
```

### Private simulation state

The existing normalized `classifier` values, perturbation/overlay mechanics,
seeds, event templates, weights, and direct causal mappings remain internal.
They are implementation machinery, not a claim about what a real device or
service exposes. The terms `classifier`, `overlay`, `perturbation`, `seed`,
and `simulation` remain forbidden in all normal public HTTP, WebSocket, event,
and documentation payloads.

### Public network-health indicators

A public health indicator is a stable observation with ordinary network
meaning. It may be a direct modeled counter, rate, latency, percentage, level,
or configuration fact. It has a documented unit, scope, direction, history,
and relationship to one or more public metrics. It never exposes a raw model
score, model weight, internal fault ID, or direct statement that it is the
driver of a simulation.

Examples of credible public indicators include DHCP lease success rate, DNS
resolution success rate, client density, channel utilization, retry rate,
low-RSSI client ratio, AP CPU utilization, memory pressure, device uptime, and
temperature. The audit decides the actual V1 catalog; this list is not a
commitment to expose every current classifier.

### Public metrics

Existing metrics remain outcome-oriented: successful connects, time to
connect, capacity, throughput, coverage, roaming, and AP health. The product
may present relevant public indicators as “related health signals” or
“contributing signals.” It must not claim that a displayed signal is a proven
root cause or disclose fixed calculation weights.

## What exists today

The current codebase already contains an implicit, but internal, decomposition:

- `README.md` defines 23 normalized classifiers and their fixed metric weights.
- `backend/simulator/realistic_generator.py` generates classifier values and
  derives the seven metrics.
- `backend/storage/metrics_store.py` persists a `classifiers` JSON column with
  each metric observation.
- `backend/server/models.py` exposes `ClassifierStatus` and embeds
  `classifiers` in metric observations.
- `backend/server/http_api.py` currently exposes classifier data through
  metric payloads, `/api/metrics/{metric}/classifiers/current`, and
  `/api/classifiers/{classifier}/baseline`.
- `frontend/src/main.ts` has a static `METRIC_CLASSIFIERS` mapping and fetches
  classifier baselines. `frontend/src/chart/ChartView.ts` renders classifier
  gauges in the metric tooltip.

This is useful implementation material, but it is not a public contract. In
particular, normalized 0–1 model scores, fixed weights, labels such as
`rssi_tuning`, and an arbitrary green/yellow/red threshold are not automatically
credible device telemetry.

## Goals

1. Preserve useful human explainability in the normal dashboard and the API.
2. Give every public indicator a domain meaning that can be explained without
   mentioning the simulator.
3. Preserve historical and streaming indicator observations with normal
   resource and timestamp semantics.
4. Ensure incident overlays and remediation affect public indicators through
   the same observable path as metrics.
5. Keep raw classifier state available only to the private operator/debug
   surface needed to build and test the simulator.
6. Remove duplicate, static frontend knowledge of metric decomposition.

## Non-goals for V1

- Claim that the catalog has been validated with real network operators.
- Build a universal network telemetry schema.
- Expose every current classifier or every internal calculation weight.
- Provide automated root-cause analysis or assert causal certainty.
- Change the seven existing outcome metrics, their names, or their baselines
  solely because this observability contract is introduced.

## Phase 0 — indicator-contract audit and decision record

Complete this phase before implementing public endpoint or UI changes. The
deliverable is a reviewed catalog at
`docs/health-indicators-v1.md`, with one row for every current classifier and
no unclassified row.

For each current classifier, choose exactly one disposition:

| Disposition | Meaning | Public treatment |
|---|---|---|
| `public_indicator` | Has a credible operational meaning and an honest unit or bounded level. | Expose through the public health-indicator contract. |
| `public_configuration` | Represents a relatively stable device/site capability or setting rather than time-series health. | Expose in resource inventory/configuration, not as a changing health indicator. |
| `private_diagnostic` | Exists mainly to make the simulator behave realistically or cannot be named/valued honestly for a client. | Keep only below private test diagnostics. |
| `retire` | Adds no useful observable behavior after the catalog decision. | Remove only after confirming no metric or scenario needs it. |

The audit must use this rubric:

1. Can a network product collect or reasonably infer this from a named resource
   or service?
2. Can the value have a defensible unit, direction, and precision rather than
   an unexplained 0–1 health score?
3. Would an operator understand the label without simulator documentation?
4. Does a time history help diagnose an outcome metric or a remediation result?
5. Does exposing it reveal a fixed internal weight, fault template, or model
   mechanic?
6. If it is configuration, should it appear as a property/capability instead
   of a volatile health signal?

Expected audit starting points—not decisions—are:

| Current internal concept | Likely audit question |
|---|---|
| `association`, `authorization`, `dhcp`, `dns` | Can these become success-rate indicators with attempt counts and an explicit observation window? |
| `client_density`, `airtime_utilization`, `cca_busy`, `retry_rate` | Can these become radio-level count/percentage indicators with clear scope? |
| `cochannel_interference`, `nonwifi_interference`, `signal_strength`, `low_rssi_clients` | What ordinary RF unit/level is credible, and which resource owns it? |
| `cpu`, `memory`, `uptime`, `temperature` | Can these use normal device units such as percent, seconds, and degrees? |
| `channel_width`, `ap_density`, `cell_overlap`, `rssi_tuning`, `80211rk_support` | Are these configuration/topology facts, private diagnostics, or genuinely changing health observations? |

The decision record must also name the minimum V1 catalog. Start with a small
set that supports the initial incident scenarios: DHCP service health, DNS
service health, client density, airtime/channel utilization, retry rate,
interference level, AP CPU utilization, device uptime, and a low-RSSI-client
signal if coverage remains in scope. Add more only when each passes the rubric.

## Public health-indicator contract

### Catalog metadata

Publish a versioned catalog as data owned by the backend. The frontend must not
maintain its own metric-to-indicator mapping.

```json
{
  "catalog_version": "v1",
  "indicators": [
    {
      "id": "dhcp_lease_success_rate",
      "label": "DHCP lease success rate",
      "description": "Percentage of DHCP lease requests completed successfully during the observation window.",
      "resource_types": ["access_point", "dhcp_service"],
      "scope": "resource",
      "value_kind": "percentage",
      "unit": "%",
      "range": {"min": 0, "max": 100},
      "direction": "higher_is_healthier",
      "precision": 1,
      "observation_window_seconds": 300,
      "related_metrics": ["successful_connects", "time_to_connect"],
      "history_supported": true
    }
  ]
}
```

Required metadata fields are `id`, `label`, `description`, `resource_types`,
`scope`, `value_kind`, `unit`, `range`, `direction`, `precision`,
`related_metrics`, and `history_supported`. A rate or count also declares its
observation window when applicable. `id` is a stable, lowercase snake-case API
identifier; labels and descriptions may evolve without changing the ID.

The catalog does not contain raw classifier names, normalized internal values,
metric weights, incident-run information, or a claim that one signal is the
sole cause of a metric change.

### Observation envelope

Every public value uses this shape:

```json
{
  "indicator_id": "dhcp_lease_success_rate",
  "resource_id": "AP-Floor1-01",
  "observed_at": 1780000000,
  "value": 64.2,
  "unit": "%",
  "status": "critical",
  "observation_window_seconds": 300
}
```

`status` is optional when the catalog marks an indicator as status-bearing. Its
thresholds must be expressed in the indicator's public unit and stored with the
catalog version. It is never inherited directly from private classifier
thresholds. Missing, stale, and unsupported values use explicit availability
states; they are not converted to a fabricated green value.

### Public endpoints and streaming

Add these normal monitoring endpoints:

```text
GET /api/health-indicators
GET /api/resources/{resource_id}/health-indicators/current
GET /api/resources/{resource_id}/health-indicators/{indicator_id}/history?start=&end=
```

`GET /api/health-indicators` returns catalog metadata. The resource endpoints
return only indicators valid for that resource type. History is timestamped
observations in the same order and time semantics as metric history. The metric
dashboard uses the catalog's `related_metrics` field to select related signals;
it does not receive a private dependency graph.

The WebSocket adds a normal `health_indicator` message:

```json
{
  "type": "health_indicator",
  "indicator_id": "dhcp_lease_success_rate",
  "resource_id": "AP-Floor1-01",
  "observed_at": 1780000000,
  "value": 64.2,
  "unit": "%",
  "status": "critical"
}
```

Existing public metric history and WebSocket metric messages remove their
`classifiers` field in the same release. They retain only metric values and
normal public metadata. The UI may request indicator history for a selected
resource/time range or cache streamed observations to populate a metric
tooltip at the cursor timestamp.

### Public explanation language

The UI and API use cautious language:

- “Related health signals” for catalog relationships.
- “Degraded” or “elevated” only when public thresholds support it.
- “May be contributing” when showing a signal beside a metric.

They must not say “classifier,” “weight,” “simulation driver,” “overlay,” or
“root cause” unless the product genuinely has a separate causal-analysis
feature with evidence to support that conclusion.

## Private diagnostic contract

Keep the current raw classifier data for the simulator operator only. Align it
with the incident-run plan's private diagnostic boundary:

```text
GET /api/test/diagnostics/metrics/{metric}/classifiers/current
GET /api/test/diagnostics/classifiers/{classifier}/baseline
GET /api/test/diagnostics/classifiers/{classifier}/history
```

These endpoints require the private operator authorization policy defined by
the incident-run plan. They may expose normalized values, weights, thresholds,
and mappings because they are for simulator construction and debugging. They
must never be referenced by the normal monitoring dashboard or a public API
client.

## Mapping and storage design

Add a backend-owned `HealthIndicatorCatalog` and mapper. It is the sole place
that converts clean-plus-observed internal state into public indicator values.
It must be deterministic for a given observed state and catalog version.

For every public indicator, define:

1. source resource and scope;
2. internal input(s), which remain private;
3. public conversion formula and rounding;
4. public threshold policy, if any;
5. sampling cadence and history retention;
6. related public metrics; and
7. incident/remediation behavior observable through the converted value.

Use a separate `health_indicator_observations` table rather than renaming the
existing `metrics.classifiers` JSON column in place. Required columns are
`observed_at`, `indicator_id`, `resource_id`, `value`, `unit`, `status`,
`catalog_version`, and optional `observation_window_seconds`. Index by
`(resource_id, indicator_id, observed_at)`.

The live generator emits public indicator observations from the same observed
state used to derive metrics. Incident overlays therefore alter indicators and
metrics coherently, while the base storage remains clean under the transient
incident-run design. The transient journal/recording rules in
`incident-runs-and-remediation-api.md` apply equally to indicator history:
transient indicator observations appear only while a journal exists, while a
recording preserves them in the private recording artifact.

## UI migration

The current tooltip is a useful interaction pattern, not a validated taxonomy.
Preserve its ability to show metric-adjacent evidence, but replace internal
classifier gauges with public indicator rows.

1. Remove static `METRIC_CLASSIFIERS` from `frontend/src/main.ts`.
2. Load the backend catalog once, cache by `catalog_version`, and derive the
   related-indicator list from catalog metadata.
3. Replace `ClassifierValue`, classifier baselines, and classifier gauges in
   `ChartView` with `HealthIndicatorObservation` and indicator-specific display
   formatting.
4. Render a label, formatted value, unit, public status, and timestamp. Show a
   baseline/range only when the public catalog defines it in the displayed unit.
5. At a hovered metric timestamp, show the nearest corresponding indicator
   observation and label it if it is not exactly time-aligned. Do not use a
   stale “latest classifier” cache without disclosure.
6. Use “Related health signals” and no calculated contribution percentage or
   hidden metric weight.
7. Move the existing classifier visualization, if retained, to a clearly
   private operator diagnostics view.

The normal dashboard must work when an indicator is unavailable, a resource
does not support it, or historical indicator data predates the catalog cutover.

## Migration and compatibility

1. Add catalog, mapper, storage, API models, and tests while leaving current
   classifier endpoints private-but-functional during development.
2. Backfill no fake public indicator history. Start public indicator history at
   the catalog cutover; report its actual availability window.
3. Update the dashboard to use the public catalog and indicator endpoints.
4. Move classifier endpoints under `/api/test/diagnostics/*` and enforce the
   private authorization boundary.
5. Remove `classifiers` from public metric HTTP and WebSocket schemas and add
   schema tests that fail if it reappears.
6. Update the README so it describes public indicators separately from private
   simulation primitives.
7. Update the incident-run API exposure matrix and `api_surface_manifest` in
   the same release.

There is no public compatibility alias for a classifier endpoint. A public
client must migrate to the health-indicator contract rather than learn a new
name for a simulator primitive.

## Verification

### Catalog and mapping tests

- every current classifier has exactly one Phase 0 disposition;
- every public indicator has all required catalog metadata and a documented
  conversion, unit, direction, and scope;
- public indicators contain no forbidden private terms or raw normalized score;
- values respect public range, precision, and status threshold rules;
- the same observed state and catalog version produces the same indicator;
- a shared internal condition creates coherent changes in all relevant public
  metrics and indicators without exposing its internal mapping.

### API and storage tests

- catalog, current, history, and WebSocket contracts validate exactly;
- resource/type filtering never returns an unsupported indicator;
- history order, timestamps, and availability states are correct;
- public metric payloads, events, and WebSocket messages contain no
  `classifiers`, weights, seeds, overlays, or diagnostic fields;
- private classifier routes reject an unauthorised or public principal;
- transient run reset/expiry removes transient indicator history from normal
  queries, while recordings retain it through private recording queries.

### UI tests

- dashboard behavior is driven by backend catalog metadata, not a static map;
- tooltip formatting uses public units and direction, including lower-is-better
  indicators;
- unavailable and time-misaligned values are visible as such;
- the normal dashboard makes no request to `/api/test/diagnostics/*`;
- an incident and successful remediation visibly change and recover related
  health signals along with the outcome metric.

### Review gate

Before implementation of public endpoints, review `docs/health-indicators-v1.md`
with product/design and at least one technically credible network reviewer if
available. The gate is not “operators have validated the full UI.” The gate is:

1. every V1 public indicator has an honest name, unit, scope, and history
   semantics;
2. none leaks simulator mechanics;
3. the chosen V1 catalog supports diagnosis of the initial incident scenarios;
4. configuration facts are not disguised as volatile health signals; and
5. the normal dashboard uses public signals while private diagnostics remain
   clearly segregated.

## Sequencing with incident runs and remediation

Complete Phase 0 and the public catalog/model contract before Milestone C of
`incident-runs-and-remediation-api.md` (device capabilities and remediation).
The overlay engine may be implemented independently, but end-to-end incident,
action, and UI work must target public indicators rather than raw classifiers.
Update the incident plan's public API examples and acceptance checklist once
the V1 catalog has been approved; its private classifier diagnostics rule then
becomes an implementation detail of this plan.
