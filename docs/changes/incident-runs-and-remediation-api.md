# Incident Runs and Remediation API

Status: proposed implementation plan
Date: 28-Aug-2026

## Purpose

Turn the current scenario controls into a repeatable fault-injection system
for testing connected monitoring and operations systems.

The default behavior will be transient: an incident run temporarily disturbs
the simulated network, emits believable telemetry, accepts remediation
actions, and then leaves the clean simulator state intact. Completed runs may
optionally be retained as recordings, but recording is a separate policy from
simulation behavior.

## Design decisions

### 1. An incident run is the unit of simulation

An incident run has:

- a public `incident_id` suitable for correlation in normal API payloads
- an internal run identifier for test control and diagnostics
- scenario, seed, target resources, severity, and start time
- one or more active fault instances
- lifecycle state: `pending`, `active`, `recovering`, `resolved`, `expired`,
  or `cancelled`
- action attempts and their outcomes
- a retention/recording policy

The scenario is the reusable definition. The incident run is one execution of
that definition.

### 2. Fault effects are overlays, not permanent classifier mutations

The simulator will preserve clean classifier state and calculate observed
state as:

```text
observed classifier state = clean state + active incident effects
```

An effect must be removable by incident ID. It must not accumulate every time
the 30-second metric loop runs, and it must not alter baselines or unrelated
incidents.

### 3. Monitor-facing and test-control APIs are separate

The monitor-facing API exposes believable devices, capabilities, events,
metrics, operations, and errors. It must not expose `classifier`,
`perturbation`, `scenario seed`, or simulator-specific reset concepts.

The private test-control API exposes run creation, deterministic replay inputs,
diagnostics, clock advancement in a dedicated test process, cancel, and reset. This is the operator surface used
to prepare repeatable integration tests.

### 4. Remediation operates on fictional network devices

Connected systems request domain actions such as `restart`,
`change_channel`, `restore_dhcp`, or `isolate_rogue_ap`. They never write
classifier values directly.

Each supported action has a policy defining preconditions, delay, success or
failure behavior, fault transitions, classifier effects, side effects, and
events.

### 5. Retention is configurable

The default test run is transient and expires from the active simulator state.
Its telemetry may be retained briefly for debugging. An explicit recording
mode can persist the event and metric output as historical data. Recorded data
must be generated through the same causal path as live data.

## Target architecture

```text
Clean network state
        |
        v
Incident run creates fault instances
        |
        v
Temporary fault overlays affect observed classifiers
        |
        v
Metrics, events, and operation status are emitted
        |
        v
Connected system investigates and invokes device actions
        |
        v
Action policy changes fault state after realistic delay
        |
        v
Incident resolves or expires; overlays are removed
```

## Phase 1: clean, transient incident runs

### 1. Establish a canonical incident and fault catalog

Refactor the current scenario definitions in `backend/simulator/scenarios.py`
and event definitions in `backend/simulator/event_catalog.py` into a clear
catalog contract.

Each scenario should define:

- human-facing label and description
- trigger timeline and fault instances
- target scope: one device, a device group, a service, or neighboring devices
- severity and seed behavior
- expected observable events
- natural recovery policy
- eligible remediation actions
- estimated duration and terminal condition

Each fault definition should define its temporary classifier overlay without
exposing that representation through the public API.

### 2. Implement an incident overlay manager

Add an incident-run manager responsible for:

- creating and indexing runs
- adding/removing fault instances
- calculating active effects by entity and timestamp
- supporting overlapping incidents without cross-contamination
- expiring effects deterministically
- clearing all effects for one run
- reporting active fault state to the private test-control API

Update `RealisticMetricsGenerator` so it computes classifier observations from
clean state plus active overlays. Preserve the existing OU state as the clean
network process.

Required invariant: after `reset`, `cancel`, or natural expiration, generating
the same clean sequence with the same seed produces the same values as it
would have without the incident.

### 3. Define lifecycle and clock semantics

Support:

- wall-clock live operation
- deterministic timestamps for tests
- optional accelerated clock for integration testing
- explicit reset/cancel
- natural expiration
- resolution after successful remediation

The scenario scheduler should be supervised and expose its health. A failed
background task must be restarted or reported through service health rather
than silently stopping incident generation.

### 4. Correct event and historical-data behavior

Live and recorded events should share one schema and one catalog. Remove the
bootstrap path that creates marker-only events with legacy event names.

Default bootstrap behavior should generate clean history and no incident
markers, or generate fully causal recorded runs. It should not create events
that imply metric impact which never occurred.

Events should use normal operational fields such as:

- `incident_id`
- `event_id`
- `entity`
- `severity`
- `timestamp`
- `message`
- `correlation_id`

Internal scenario metadata can remain available through the private test
surface.

### 5. Shape the private test-control API

Proposed endpoints:

```text
POST /api/test/incident-runs
GET  /api/test/incident-runs/{id}
POST /api/test/incident-runs/{id}/reset
POST /api/test/incident-runs/{id}/cancel
```

The existing scenario trigger endpoint can remain temporarily as a
compatibility facade, but new behavior should use incident-run terminology.

### 6. Define run retention and recording

Add explicit options such as:

- `transient`: remove run-owned state and its short-lived journal after completion
- `record`: preserve causal output as a separate recording for historical analysis

Run-owned data must be identifiable and removable without deleting clean
network history.

## Phase 2: believable remediation API

### 1. Define the fictional device model

Document the supported resource types and operations. Start with the existing
AP topology and add only devices needed by the first scenarios.

Example resource types:

- access point
- DHCP service
- RADIUS service
- DNS service
- wireless controller or switch, if required by a scenario

Each resource should expose a realistic identity, status, capabilities, and
operational constraints.

### 2. Add capability discovery

Provide a monitor-facing capability endpoint, for example:

```text
GET /api/resources/{resource_id}/capabilities
```

Return supported operations, required parameters, current preconditions,
estimated duration, and whether approval or inventory is required.

Only operations supported by the fictional world need to be listed. Errors for
unsupported operations should use ordinary API/domain semantics and contain no
simulator-specific wording.

### 3. Add asynchronous device actions

Proposed contract:

```text
POST /api/resources/{resource_id}/actions
GET  /api/operations/{operation_id}
```

Request fields should include:

- action name
- action parameters
- client-supplied request/idempotency key
- optional correlation ID

The response should acknowledge an operation, not assert that remediation has
already succeeded. The connected system verifies the result through events,
metrics, and device status.

### 4. Implement action policies

Create an action policy registry separate from the classifier catalog. Each
policy should specify:

- supported resource types
- preconditions
- operation duration and intermediate states
- success, failure, and partial-success outcomes
- faults cleared, reduced, or introduced
- classifier overlays produced internally
- collateral effects
- emitted operation and device events

Examples:

| Action | Primary result | Possible side effect |
|---|---|---|
| `restart` | device health recovers after a short outage | temporary client disconnects |
| `change_channel` | RF interference decreases | short roaming disruption |
| `restore_dhcp` | DHCP fault clears after service delay | queued clients retry |
| `isolate_rogue_ap` | rogue-AP RF effect clears | affected clients reassociate |
| `rebalance_clients` | density and airtime pressure decrease | transient client movement |
| `rollback_firmware` | firmware fault clears | device restart and downtime |

### 5. Keep diagnosis outside the simulator

The simulator may retain the actual injected fault internally, but the
connected system should infer root cause from normal observations. The action
API should not reveal which action will resolve the incident.

Wrong or ineffective actions should be valid test outcomes. They may create
ordinary change events, leave the fault active, or introduce collateral
degradation.

### 6. Connect remediation to incident lifecycle

When an action changes a fault:

1. accept and record the operation
2. emit an operation/change event
3. apply the result after its modeled delay
4. update temporary fault overlays
5. emit resulting device and service events
6. transition the incident to `recovering` or `resolved` when appropriate
7. allow the monitor to verify recovery from telemetry

The private reset operation remains an unconditional cleanup mechanism and is
distinct from a remediation action.

## Verification plan

### Unit tests

- overlay effects do not accumulate across metric samples
- effects disappear at expiration
- reset removes only the selected run
- clean state and baselines are unchanged
- entity and scope filtering work correctly
- overlapping incidents combine and recover independently
- action policies enforce preconditions and idempotency
- action success, failure, and partial success produce expected transitions

### API contract tests

- scenario/run creation and lifecycle responses
- capability discovery by resource type
- action acknowledgement and operation polling
- ordinary unsupported-operation errors
- event and metric correlation IDs
- no simulator internals in monitor-facing payloads

### Black-box integration tests

For each initial scenario:

1. Create a transient incident run.
2. Observe the expected event sequence through HTTP/WebSocket.
3. Verify expected metric and classifier behavior indirectly through metrics.
4. Have a test client select and invoke a remediation action.
5. Verify operation delay, action event, metric recovery, and terminal state.
6. Reset the run and verify no residual effect.
7. Repeat with the same seed and compare the resulting telemetry envelope.

### Long-running tests

- run the simulator continuously through repeated incident creation and reset
- confirm active-run count and overlay count return to zero
- confirm no classifier drift or baseline mutation
- confirm scheduler task health remains good
- confirm storage retention remains bounded
- confirm the API remains responsive while incidents and actions are active

## Proposed implementation order

1. Finalize the incident-run, fault, action, and public event contracts.
2. Implement transient overlays and add regression tests for the accumulation
   bug.
3. Refactor scenarios to create incident runs with explicit lifecycle states.
4. Remove or gate bootstrap marker-only events and unify event schemas.
5. Add private run-control endpoints and retention behavior.
6. Define fictional device capabilities and the first remediation actions.
7. Add asynchronous operation status and action outcomes.
8. Connect actions to fault transitions and recovery telemetry.
9. Add black-box connected-system tests and long-running soak tests.
10. Migrate the UI from scenario-trigger terminology to incident-run status and
    action visibility.

## Out of scope for the first implementation

- modeling every real network vendor or device type
- arbitrary classifier writes through an API
- unrestricted topology editing
- fully realistic hardware inventory management
- retaining every test run permanently

The first release should make a small fictional world internally coherent,
repeatable, observable, and actionable. Additional faults and actions can then
be added as new catalog entries without changing the simulation architecture.

---

# Implementation specification (v1)

This section turns the plan above into an executable contract. The choices in
this section are intentional v1 decisions; an implementation must follow them
unless this document is revised.

## V1 boundary

V1 supports one continuously running simulated network and many independent,
temporary incident runs. It does not introduce separate tenant or network
sessions.

Each incident run is created by the private test-control API and is observable
through the normal monitoring API. The connected system uses only the
monitor-facing endpoints. The dashboard is an operator/test-control client and
may use the private endpoints after authentication is added.

The normal baseline remains clean. A transient run never writes its effects
into the clean classifier process or the baseline artifact.

## Exact runtime model

### `IncidentRun`

Create `backend/simulator/incident_runs.py` with these dataclasses (equivalent
Pydantic models are acceptable at the HTTP boundary):

```python
IncidentRun(
    run_id: str,                 # private: run_<uuid>
    incident_id: str,            # public: inc_<uuid>
    scenario_id: str,            # private catalog key
    seed: int,
    severity: Literal["warning", "critical"],
    target_resource_id: str,    # exactly one AP in V1
    started_at: int,
    state: Literal[
        "pending", "active", "recovering", "resolved", "expired", "cancelled"
    ],
    retention: Literal["transient", "record"],
    journal_expires_at: int | None,
    recording_id: str | None,
    scheduled_steps: list[ScheduledStep],
    fault_ids: set[str],
    operation_ids: list[str],
    resolved_at: int | None,
    terminal_reason: str | None,
)
```

`run_id` never appears in monitor-facing payloads. `incident_id` may appear in
events and operations as a normal correlation field.

### `FaultInstance`

```python
FaultInstance(
    fault_id: str,               # private: fault_<uuid>
    run_id: str | None,          # set for an incident-owned fault
    owner_operation_id: str | None, # set only for an action-created disturbance
    fault_type: str,             # internal catalog key
    attributes: dict[str, JSON], # e.g. {"bssid": "aa:bb:cc:dd:ee:ff"}
    entity_effects: dict[str, dict[str, float]],
                              # resource ID -> classifier -> signed amplitude
    starts_at: int,
    state: Literal["scheduled", "active", "recovering", "resolved", "cancelled"],
    impact_curve: Literal["immediate", "linear_ramp"],
    impact_duration_seconds: int,
    severity_multiplier: float,
    effect_multiplier_by_classifier: dict[str, float],
    recovery_curve: Literal["linear", "exponential", "sudden_recovery"],
    natural_recovery_at: int | None,
    recovery_started_at: int | None,
    recovery_duration_seconds: int | None,
    frozen_impact: float | None, # persisted at recovery start
    cause_operation_id: str | None,
    resolved_at: int | None,
)
```

`entity_effects` is internal implementation data. Its values are never sent to
the connected system.

### `Operation`

```python
Operation(
    operation_id: str,           # public: op_<uuid>
    request_id: str,             # client idempotency key
    resource_id: str,
    action: str,
    parameters: dict,
    affected_run_ids: tuple[str, ...], # private; a shared repair may affect many
    correlation_id: str | None, # copied from optional X-Correlation-ID header
    accepted_at: int,
    started_at: int | None,
    state: Literal["accepted", "in_progress", "completed", "failed", "cancelled"],
    completes_at: int,
    result_code: str | None,
    result_message: str | None,
)
```

The operation response reports acceptance and later status. It does not reveal
the hidden fault or promise that the chosen action will fix an incident.

### Ownership and cleanup invariants

- Every incident-owned `FaultInstance` belongs to exactly one `IncidentRun`.
  An action-created disturbance, such as an AP restart, belongs to exactly one
  `Operation` and has no run. It is still an overlay and is cleaned up when
  that operation reaches its terminal state.
- Every active overlay can be found by `fault_id`, `run_id`, and affected
  resource ID.
- Resetting a run resolves/cancels all of that run's faults and never touches
  another run.
- A terminal run has zero active fault overlays.
- Removing a fault changes only observed classifier values; it does not reset
  or overwrite the clean OU state.
- A run with `retention="transient"` is removed from the private active-run
  registry after its terminal telemetry retention window expires.

## Overlay algorithm

### Clean state remains authoritative

`RealisticMetricsGenerator` continues to advance one clean, per-entity
classifier state using its existing OU process. Remove the current behavior
that writes perturbation effects into that stored state.

For every generated metric frame at time `t` and entity `e`:

```text
clean[e, classifier]     = existing OU-generated classifier value
overlay[e, classifier, t] = sum(effect_of_each_active_fault(e, classifier, t))
observed[e, classifier]  = clamp(clean + overlay, 0.0, 1.0)
metric[e]                = existing metric derivation(observed classifiers)
```

Metric derivation must receive the observed classifier snapshot, while the next
OU update always starts from the clean classifier snapshot.

### Effect calculation

Let `A` be a signed effect amplitude, `s` the fault start time, and `t` the
observation timestamp.

```text
if state is scheduled and t < s:             effect = 0
if state is active:                          effect = A × impact_progress(t)
if state is recovering:                      effect = A × frozen_impact × recovery_progress(t)
if state is resolved or cancelled:           effect = 0
```

V1 curve definitions:

| Curve | Formula |
|---|---|
| `immediate` | `impact_progress = 1` at and after `starts_at` |
| `linear_ramp` | linearly rises from `0` to `1` during configured ramp time |
| `linear` recovery | `max(0, 1 - elapsed / recovery_duration)` |
| `exponential` recovery | `exp(-3 × elapsed / recovery_duration)` until forced to `0` at the duration boundary |
| `sudden_recovery` | `1` for the first 80% of recovery duration, then linearly falls to `0` |

At the instant recovery begins, `frozen_impact` is the fault's impact progress
at that instant. The impact ramp stops there; recovery always starts from that
current amplitude, including when recovery begins before a linear ramp would
otherwise finish. Natural expiration transitions a fault to `recovering` at
`natural_recovery_at`. Successful remediation transitions the affected fault
to `recovering` at operation completion. Reset/cancel transitions it directly
to `cancelled` and produces zero effect immediately.

Effects add before the final `0.0..1.0` clamp. This makes overlapping incidents
observable while keeping every classifier value valid.

### Required regression test

For a critical DHCP fault on one AP, sample every 30 seconds until after the
fault resolves. The difference between clean and incident values must return to
zero at resolution. It must not remain as a residual deficit in subsequent
clean-state samples.

## State-transition contract

### Incident runs

| Current state | Trigger | Next state | Required consequence |
|---|---|---|---|
| `pending` | first scheduled fault starts | `active` | emit incident-start operational event |
| `active` | an effective action begins recovery of every remaining active fault | `recovering` | retain incident correlation; emit action event |
| `active` | last fault naturally begins recovery | `recovering` | emit recovery-start event |
| `recovering` | all faults reach zero effect | `resolved` | emit resolved event and set `resolved_at` |
| `active` or `recovering` | duration ends with unresolved faults | `expired` | cancel remaining overlays; emit expired event |
| any non-terminal | private reset/cancel | `cancelled` | remove run overlays immediately; emit operator-only audit event |

`resolved`, `expired`, and `cancelled` are terminal states. A new test attempt
creates a new run; terminal runs are never restarted.

### Operations

| Current state | Trigger | Next state |
|---|---|---|
| — | valid request with new `request_id` | `accepted` |
| `accepted` | dispatcher processes its due-now start command | `in_progress` |
| `in_progress` | modeled action completes successfully | `completed` |
| `in_progress` | modeled action failure | `failed` |
| `accepted` or `in_progress` | private run reset | `cancelled` |

Repeated requests with the same `request_id`, resource, and action return the
original operation. Reusing a request ID with different content returns `409`.

A valid operation is recorded as `accepted` and immediately enqueued with
`starts_at = accepted_at`. Before the HTTP handler returns its `202`, it asks
the dispatcher to process due work at `accepted_at`; the dispatcher alone then
transitions the operation to `in_progress`, sets `started_at`, and emits a
normal `operation_started` event. The `202` remains an admission response with
`status: accepted`; an immediate `GET /api/operations/{id}` may therefore show
`in_progress`. The same rule applies under `TestClock`, with no one-second
polling delay or wall-clock dependency.

## Scenario contract

Replace the current event-only scenario steps with a sequence of typed steps:

```python
ScenarioSpec(
    scenario_id: str,
    label: str,
    description: str,
    default_severity: str,
    max_duration_seconds: int,
    steps: tuple[
        StartFaultStep | EmitEventStep | StartRecoveryStep,
        ...
    ],
)
```

`StartFaultStep` references a fault template and defines its target selector.
`EmitEventStep` emits a normal operational event only. `StartRecoveryStep`
starts natural recovery for a named fault only when the scenario intentionally
has a natural resolution.

Every scenario must declare:

- at least one `StartFaultStep`
- a maximum duration
- a natural resolution/expiration policy
- target resources and any dependent resources
- the actions that can affect each fault

## V1 fictional network inventory

Keep the existing APs and add shared resources required for believable action
targets:

| Resource ID | Type | Depends on / serves |
|---|---|---|
| `AP-Floor1-01` through `AP-Floor3-02` | access point | wireless clients |
| `DHCP-01` | DHCP service | all APs |
| `DNS-01` | DNS service | all APs |
| `RADIUS-01` | authentication service | all APs |
| `SW-DIST-01` | distribution switch | all APs |
| `RF-SEC-01` | RF security service | rogue-AP detection/isolation |

Topology must encode the AP-to-shared-resource dependencies. A shared-service
fault can therefore affect a selected AP, a selected AP group, or all APs as
the scenario specifies.

## V1 fault and remediation matrix

These are the required initial scenarios and behaviors. They are deliberately
finite. Additions require a catalog entry, action policy, tests, and a public
capability decision.

| Scenario | Faults and initial effect | Available effective action | Required action outcome |
|---|---|---|---|
| DHCP outage | `dhcp_service_unavailable`: target AP `dhcp -0.35`; at +180s `dns -0.20` | `restore_dhcp` on `DHCP-01` | completes after 45s; both faults recover linearly over their scenario-defined durations |
| Major switch failure | `distribution_uplink_failure`: target AP `uptime -0.50`, `cpu -0.20`; neighboring APs `client_density -0.15`, `airtime_utilization -0.12` | `failover_uplink` on `SW-DIST-01` | completes after 90s; all switch-run faults recover on their scenario-defined curve |
| Rogue AP attack | `rogue_ap_present`: target AP `cell_overlap -0.30`, `retry_rate -0.25`; at +150s `rf_interference` | `isolate_rogue_ap` on `RF-SEC-01` | completes after 60s; both matching-BSSID faults recover on their scenario-defined curve |
| Firmware rollout failure | `firmware_regression`: target AP `uptime -0.35`, `cpu -0.20` | `rollback_firmware` on target AP | completes after 120s; emits normal restart lifecycle events, then the fault recovers on its scenario-defined curve |
| High-density surge | `client_surge`: target AP `client_density -0.25`, `airtime_utilization -0.20` | `rebalance_clients` on target AP | completes after 60s; reduces fault amplitude by 60%, then natural recovery completes on its scenario-defined timeline |

All runs use the severity multipliers already established in the event catalog:
`warning = 0.70` of the listed amplitude and `critical = 1.00`.

### Required ineffective and partial actions

The following behavior is required to test reasoning rather than only happy
paths:

- `restart` on an AP during a DHCP outage is accepted and completes, creates a
  short AP restart disturbance, and does not resolve the DHCP fault.
- `change_channel` during a rogue-AP attack reduces the RF-interference fault
  amplitude by 60% but leaves the rogue-AP fault active.
- `rebalance_clients` during a major switch failure is accepted but has no
  lasting effect until uplink failover succeeds.

These outcomes must be deterministic for a given run seed.

## Public monitoring API contract

The monitor-facing API has no scenario, classifier, overlay, perturbation,
seed, test-run, or reset fields.

### Resource discovery

```http
GET /api/resources
GET /api/resources/{resource_id}
GET /api/resources/{resource_id}/capabilities
```

Capabilities response:

```json
{
  "resource_id": "DHCP-01",
  "resource_type": "dhcp_service",
  "operations": [
    {
      "name": "restore_dhcp",
      "parameters": [],
      "estimated_duration_seconds": 45,
      "availability": "available"
    }
  ]
}
```

Only supported operations are listed. `availability` may be `available`,
`temporarily_unavailable`, or `requires_approval`; it must never say an action
is unavailable because of simulator limitations.

### Operations

```http
POST /api/resources/{resource_id}/actions
GET  /api/operations/{operation_id}
```

Action request:

```json
{
  "action": "restore_dhcp",
  "parameters": {}
}
```

`Idempotency-Key` is a required HTTP header. `X-Correlation-ID` is an optional
HTTP header. For an action-created event or operation, `correlation_id` equals
the header value when present; otherwise it equals that operation's
`operation_id`. Scenario-originated events have no `correlation_id` until an
action affects them. This rule is invariant across HTTP and WebSocket payloads.
`parameters` is the action-specific object; its schema is the strict schema in
the V1 action table below. The request envelope itself permits only `action`
and `parameters`.

Accepted response (`202`):

```json
{
  "operation_id": "op_01H...",
  "resource_id": "DHCP-01",
  "action": "restore_dhcp",
  "status": "accepted",
  "accepted_at": 1780000000,
  "estimated_completion_at": 1780000045
}
```

Operation response:

```json
{
  "operation_id": "op_01H...",
  "resource_id": "DHCP-01",
  "action": "restore_dhcp",
  "status": "completed",
  "accepted_at": 1780000000,
  "completed_at": 1780000045,
  "correlation_id": "optional-client-correlation-id"
}
```

The completion response does not say whether an incident has recovered. That
remains observable through normal events and metrics.

### Errors

| Condition | HTTP status | Error code |
|---|---:|---|
| unknown resource | 404 | `resource_not_found` |
| malformed action request | 400 | `invalid_request` |
| action absent from resource capability set | 422 | `operation_not_supported` |
| valid action blocked by current device state | 409 | `operation_conflict` |
| same request ID, different request | 409 | `idempotency_conflict` |

Error messages must use normal operational wording, for example: “Operation
is not supported for resource type `access_point`.” They must never refer to a
simulation, mock, scenario, classifier, or topology limitation.

### Events and metrics

Continue to use `/api/events`, metric history endpoints, and WebSocket
broadcasts. Add these public event fields where applicable:

```json
{
  "event_id": "evt_...",
  "incident_id": "inc_...",
  "correlation_id": "op_... (or supplied X-Correlation-ID)",
  "entity": "DHCP-01",
  "related_resources": ["AP-Floor1-01"],
  "event_type": "dhcp_service_degraded",
  "severity": "critical",
  "timestamp": 1780000000,
  "message": "DHCP service degradation affecting AP-Floor1-01"
}
```

For `rogue_access_point_detected`, the same envelope additionally has
`"bssid": "aa:bb:cc:dd:ee:ff"`. BSSID is a normal network identity field,
not simulator metadata, and is the value required by `isolate_rogue_ap`.

Do not expose the internal cause or classifier mapping. Legacy fields carrying
simulator internals move to the private diagnostics surface at cutover; public
V1 payloads do not preserve them for compatibility.

## Private test-control API contract

These endpoints require a test-operator authorization boundary before they are
exposed outside local development.

```http
POST /api/test/incident-runs
GET  /api/test/incident-runs/{run_id}
POST /api/test/incident-runs/{run_id}/reset
POST /api/test/incident-runs/{run_id}/cancel
GET  /api/test/clock
POST /api/test/clock/advance
```

Create request:

```json
{
  "scenario_id": "dhcp_outage",
  "target_resource_id": "AP-Floor1-01",
  "severity": "critical",
  "seed": 24680,
  "retention": "transient",
  "deterministic": true,
  "replay_namespace": "4d61a960-3d0f-4d8a-bb1c-e4a884e45dc3"
}
```

The initial V1 scenarios accept exactly one `target_resource_id`. It must name
an existing access point; a missing resource or a resource of another type is
`400 invalid_request`. The server derives every additional affected resource
from the topology and selector rules. V1 deliberately has no plural target
form: a caller creates separate runs to test a multi-AP incident.

`deterministic` defaults to `false`. When it is `true`, both `seed` and
`replay_namespace` are required and must be retained only in private test
records; neither appears in the public monitoring API.

Create response (`201`) includes the private `run_id`, public `incident_id`,
scheduled timeline, active state, and private diagnostic fault summaries.

`POST /api/test/clock/advance` accepts `{ "to": <Unix UTC seconds> }`. It is
available only when the process was started in private deterministic-test mode;
otherwise it returns `409 test_clock_not_enabled`. The value must be at or after
the current test-clock time. It calls `dispatcher.advance_to(to)` synchronously
and returns `{ "now": to, "processed_transition_count": <integer> }`.
`GET /api/test/clock` returns the current test-clock time and whether clock
control is enabled. These endpoints are never enabled on the normal public
production process.

`reset` is idempotent and has state-specific behavior:

| Current run state | Result | Response fields |
|---|---|---|
| `pending`, `active`, `recovering` | cancel faults and pending operations, then purge the transient journal | `state: "cancelled", journal_purged: true` |
| `resolved`, `expired`, `cancelled` | preserve the immutable terminal state; purge its remaining transient journal if present | original `state`, `journal_purged: true|false` |

All reset responses are `200`. A recording is never deleted by reset. A
terminal run has no remaining overlay before this endpoint returns, so the next
metric frame is clean. `cancel` follows the same terminal-state rule but, for a
transient run, preserves the normal 15-minute journal rather than purging it.

## Persistence and migration

### New persistence

Add SQLite tables or equivalent durable storage for:

- incident runs
- fault instances
- operations
- action idempotency keys

Index incident/run state, target resource, timestamps, and operation request
ID. Store public event correlation IDs as first-class fields or indexed JSON
metadata.

### Existing components to change

| Current component | Required change |
|---|---|
| `simulator/perturbations.py` | replace persistent-state application with overlay evaluation; retain reusable curve helpers where useful |
| `simulator/realistic_generator.py` | maintain clean state and derive observed state from active overlays |
| `simulator/scenarios.py` | replace event-only runs with typed scenario steps and incident runs |
| `simulator/event_generator.py` | route scenario events through the incident-run manager; keep catalog-backed background events separate |
| `server/http_api.py` and `server/models.py` | add resource/capability/action/operation and private run-control endpoints/models |
| `storage/events_store.py` | persist only base public events; query-merge non-expired transient journals without persisting them |
| `simulator/bootstrap.py` | stop generating marker-only historical events; support explicit causal recording only |
| frontend | treat scenario controls as operator test controls; present run lifecycle and action operation status without leaking private data into public views |

### Compatibility sequence

1. Add new tables and APIs without removing existing scenario endpoints.
2. Make existing `/api/scenarios/trigger` create a transient incident run as a
   temporary compatibility adapter.
3. Update the dashboard to use private run-control endpoints.
4. Remove the marker-only bootstrap event generator on the next fresh data
   bootstrap.
5. Deprecate the old scenario endpoint only after the dashboard and automated
   clients have moved.

Existing historical marker-only events may remain queryable, but they must be
tagged as legacy data or excluded from default views. Do not rewrite user data
in place.

## Build sequence and quality gates

### Milestone A — overlay engine

Deliver:

- incident/fault dataclasses and manager
- clean-versus-observed classifier snapshots
- one DHCP fault created through a test fixture
- reset and expiration

Gate:

- the residual-effect regression test passes
- the canonical semantic hash of the clean baseline is unchanged before and
  after a transient run
- 100 create/reset cycles leave no active effects

### Milestone B — incident-run lifecycle

Deliver:

- typed scenario steps
- private run creation/status/reset endpoints
- event correlation IDs
- supervisor health for scheduler tasks

Gate:

- each run reaches one terminal state exactly once
- reset affects only its own run
- identical seeds produce the same event schedule and metric envelope

### Milestone C — device model and remediation

Deliver:

- resource inventory and capability endpoints
- operation persistence/idempotency
- DHCP outage plus `restore_dhcp`
- one ineffective action (`restart` on the target AP)

Gate:

- connected client can discover actions, submit one, poll its operation, and
  observe recovery without using any private endpoint
- public responses contain none of the banned internal terms

### Milestone D — complete V1 matrix

Deliver:

- remaining four scenarios and effective actions
- required partial/ineffective actions
- UI migration
- causal recording option

Gate:

- every matrix row has one black-box passing test
- all action outcomes are deterministic for a fixed seed
- a 24-hour accelerated soak test shows no classifier drift, leaked effects,
  unbounded storage, or dead scheduler

## Definition of done

The implementation is complete only when all of the following are true:

1. A transient incident changes telemetry while active and leaves no residual
   classifier or baseline change after reset/resolution.
2. A connected system can discover available resource actions without seeing
   simulator internals.
3. A connected system can submit an action, observe ordinary asynchronous
   operation semantics, and determine success from normal telemetry.
4. Wrong, ineffective, and partial actions have deterministic, believable
   consequences.
5. Historical recorded incidents, when enabled, contain telemetry causally
   generated by the same overlay engine as live incidents.
6. The existing dashboard, HTTP API, WebSocket stream, and continuous
   operation remain healthy through repeated runs.
7. Unit, API, black-box, and soak tests described above are automated and
   passing.

## Implementation risk and confidence

| Area | Complexity | Main risk | Confidence after its quality gate |
|---|---|---|---|
| Overlay engine | medium | preserving clean versus observed state correctly | high |
| Incident lifecycle | medium | scheduler and retention edge cases | high |
| Public remediation API | medium | contract consistency and idempotency | medium-high |
| Fault/action matrix | medium | believable but bounded behavior | medium-high |
| Causal historical recording | high | replay/storage performance and data migration | medium |
| Long-running operation | medium | leaks, task supervision, and storage bounds | medium-high |

The existing scenario, event catalog, classifier model, and test suite make
Milestones A–C a high-probability implementation. Milestone D should proceed
only after the first DHCP end-to-end path meets its black-box and soak gates;
that provides evidence that the architecture supports the remaining catalog
rather than merely assuming it does.

---

# V1 execution contract — authoritative implementation rules

This contract resolves the remaining implementation choices. Where it differs
from an earlier section of this document, this contract takes precedence.

## 1. API exposure matrix

The network-monitoring client uses only the public surface. The operator UI
and automated test harness use the private surface. The terms `scenario`,
`run`, `fault`, `overlay`, `classifier`, `seed`, and `reset` are forbidden in
all public HTTP and WebSocket payload keys, values, error messages, and API
documentation.

| Endpoint or transport | Audience | V1 rule |
|---|---|---|
| `/api/metrics*` and metric WebSocket messages | public | return only observed metric values; no classifier breakdown |
| `/api/events` and event WebSocket messages | public | return the sanitized `EventEnvelope` below |
| `/api/resources*`, `/api/resources/{id}/capabilities` | public | resource discovery and stable, type-based capabilities |
| `/api/resources/{id}/actions`, `/api/operations/{id}` | public | asynchronous device/service operations |
| `/health` | public | service health only; no active-run counts, catalog names, or scheduler internals |
| `/api/scenarios*` | removed from public surface | old routes return `410 endpoint_retired`; they do not identify a scenario API replacement |
| `/api/metrics/{metric}/classifiers/current` and `/api/classifiers/*` | private diagnostics only | move beneath `/api/test/diagnostics/*` and require operator authorization |
| `/api/test/*` | private | run creation, reset/cancel, diagnostics, recordings, and deterministic clock control |

The old dashboard scenario controls become a private operator console. Before
the public release of this feature, update its calls to `/api/test/*`; then
remove the old public scenario routes in the same release.

The implementation maintains a checked-in `api_surface_manifest` containing
every registered HTTP route, WebSocket message type, and generated API-document
page with its audience (`public` or `private`). A CI route-inventory test fails
when a router, WebSocket publisher, or generated documentation entry is absent
from the manifest, changes audience, or declares public data inconsistent with
the public envelope schemas. The existing public HTTP/WebSocket schema
snapshots remain the payload-level part of this check.

### Public event envelope

Every public event receives an immutable UUID `event_id` before publishing.
The integer primary key currently stored in `events.db` is an implementation
detail and is not returned by V1 public endpoints.

```json
{
  "event_id": "evt_67f8f00b-4d95-4d88-98e3-8dad5bf4f1c1",
  "occurred_at": 1780000000,
  "event_type": "dhcp_service_degraded",
  "severity": "critical",
  "entity": "DHCP-01",
  "related_resources": ["AP-Floor1-01"],
  "message": "DHCP service degradation affecting AP-Floor1-01",
  "incident_id": "inc_90c8e72c-54f3-4bb4-bf20-8d40e6f49d56",
  "correlation_id": "op_4de0e8ea-8bc2-4a0d-a0b8-6c65ea972f51"
}
```

`incident_id` and `correlation_id` are optional. An event is written to the
event outbox before it is broadcast; the HTTP and WebSocket copies therefore
share the same `event_id`.

`rogue_access_point_detected` additionally includes a lowercase colon-delimited
`bssid` field. It is required for that event type and absent for other V1 event
types. This makes the correct `isolate_rogue_ap` request discoverable through
ordinary operational evidence.

## 2. Transient data and recording ownership

### Transient is the default

The default `retention` is `transient`. It has these exact properties:

- The persistent base metric store contains **clean** metric frames only.
- The live WebSocket stream applies active incident overlays to a clean frame
  immediately before broadcast.
- A transient journal in `control.db` holds the incident definition, fault
  timeline, public event envelopes, operation status, and enough clean
  classifier snapshots to compose affected metric history while the journal
  exists. It is the sole durable source for transient incident events.
- `GET /api/metrics*` and `GET /api/events` merge the transient journal with
  base data only for timestamps inside the journal window.
- A journal exists while its run is non-terminal and for 15 minutes after a
  normal resolution or cancel. `journal_expires_at` is an absolute Unix UTC
  timestamp set to terminal time plus 900 seconds.
- When the journal expires, its overlays, events, and composed history cease
  to appear in public queries. Base history remains clean.
- `POST /api/test/incident-runs/{id}/reset` immediately cancels pending
  operations, removes active overlays, marks unbroadcast transient outbox rows
  discarded, and purges that run's transient journal. Events already delivered
  to a connected client cannot be retracted, but they cease to appear in every
  subsequent HTTP or WebSocket replay query immediately.

This deliberately makes a default test run disappear from later history. A
connected system can observe it in real time and in short-term historical
queries, then begin another clean attempt without polluting the baseline or
long-lived telemetry history.

### Bounded transient storage

V1 enforces these logical-storage limits; values are configuration defaults and
are observable only through private diagnostics:

- at most 32 active incident runs;
- at most 128 active-or-retained transient journals;
- at most 50 action attempts per run; and
- at most 256 transient event/outbox rows per journal.

The private create endpoint returns `429 test_capacity_exhausted` when the run
or journal cap is reached. An action beyond its run's attempt cap returns `429
operation_rate_limited`. Catalog validation rejects a scenario/action policy
whose worst-case static events plus three events per permitted action could
exceed the journal event cap. At the first dispatcher advance at or after a
journal's `journal_expires_at`, the journal and every discarded or acknowledged
transient outbox row it owns are deleted. SQLite file allocation is explicitly
not an acceptance signal; the bounded values are logical counts:
`transient_journal_count`, `transient_outbox_row_count`, and
`transient_event_row_count`. After an expiry advance, all three must be zero
for that run, and after the defined soak workload they must remain at or below
the stated global caps.

### Recording is a separate product

`retention: "record"` creates a `recording_id` and an immutable recording in
`recordings.db`. It does not append incident-affected frames to base history.

For every affected entity at the normal 30-second metric sampling interval,
the recording captures:

- clean classifier snapshot
- observed classifier snapshot (private recording metadata)
- public metric samples
- public event envelopes
- operation transitions
- the run seed and catalog versions (private recording metadata)

Recordings are available only through the private test API in V1:

```text
GET /api/test/recordings/{recording_id}
GET /api/test/recordings/{recording_id}/metrics
GET /api/test/recordings/{recording_id}/events
```

They never influence live baselines, normal metric history, or future incident
runs. The default recording expiry is 30 days; the operator may set a shorter
`recording_retention_seconds` between 3,600 and 2,592,000 seconds when creating
a run.

## 3. Time, seeds, IDs, and deterministic test mode

### Clock

All time-dependent simulation work uses one injected `Clock` interface:

```python
class Clock(Protocol):
    def now(self) -> int: ...

class WallClock: ...
class TestClock:
    def now(self) -> int: ...
    def advance_to(self, unix_seconds: int) -> None: ...
```

`IncidentDispatcher`, run scheduling, operation completion, retention expiry,
event timestamps, and test metric sampling use this clock. Production uses
`WallClock`. Tests use `TestClock`; they advance it explicitly and call the
dispatcher synchronously.

### Deterministic mode

`POST /api/test/incident-runs` accepts `deterministic: true`. It requires a
`seed` and a caller-supplied private `replay_namespace` UUID. A
deterministic-test process has exactly one instance-level `TestClock`,
`baseline_snapshot_id`, and `baseline_seed`; they are selected when the test
process starts and are not request fields. This preserves one shared network
baseline for every concurrent run. Deterministic mode enables these rules:

- background events and random load-pattern injection are disabled for the
  affected resources during the run window
- the instance-level starting clean snapshot remains immutable; every clean
  OU/noise value used while sampling derives from
  `sha256(f"{baseline_seed}:ou:{resource}:{classifier}:{sample_at}")`, never
  from a run seed, replay namespace, or process-global random state
- test metric samples are requested at exact 30-second UTC boundaries
- all other run randomness derives from
  `sha256(f"{seed}:{replay_namespace}:{purpose}:{sequence}")`
- purposes are `run_id`, `fault_id`, `operation_id`, `event_id`, `outcome`,
  and `bssid`; no component shares an RNG stream
- IDs are UUIDv5 values derived from the corresponding seed material
- due work is ordered by `(due_at, priority, sequence_number)`

For deterministic comparisons, an envelope consists of ordered public events,
operation states, and per-resource metric values rounded to the API precision.
Equal seed, replay namespace, target, scenario version, instance baseline
snapshot, baseline seed, and action requests must produce byte-for-byte equal
normalized envelopes. Volatile transport fields are absent because IDs and
timestamps are deterministic. Different deterministic runs may overlap,
including on the same AP: they see the same clean frame and their overlays add
by the standard overlay rule. The same deterministic tuple may have only one
active transient journal at a time; a concurrent create returns `409
replay_already_active`. After reset or journal expiry it may be repeated safely.
`recordings.db` keys recorded events by `(recording_id, event_id)`; a repeat of
an already completed deterministic recording returns the existing immutable
recording rather than attempting a duplicate insert.

The byte-for-byte replay guarantee applies to an isolated run, or to a fully
specified concurrent run set: every member's scenario version, seed, replay
namespace, target, start time, and action requests must be the same and members
are ordered by deterministic `run_id`. A concurrent run does not retain an
independent metric stream—real observers see the combined overlay—but it keeps
independent fault state, event IDs, operations, and reset boundary.

## 4. Dispatcher, durability, and recovery

### One owner for all transitions

Add `backend/simulator/incident_dispatcher.py`. It is the only component that
may transition a run, fault, or operation state.

Production runs it every second. It obtains a SQLite lease in `control.db`
with a 10-second expiry and renews every 3 seconds. Only the current lease
holder processes due work. Tests call `dispatcher.advance_to(clock.now())`
directly and do not start the background loop.

`advance_to(target)` processes chronological due times, not one collapsed
catch-up tick. It repeatedly finds the earliest due timestamp at or before
`target` across commands, operation starts/completions, scenario steps,
recovery starts/completions, run expiry, and retention expiry; it advances its
logical time to that timestamp and applies the following precedence only among
transitions due at that same timestamp. Once no due time remains, it advances
logical time to `target`. Wall-clock restart recovery uses this same method, so
late publication does not change the recorded `occurred_at` time or bypass an
earlier expiry.

At each due timestamp, the dispatcher performs this exact precedence order:

1. apply private reset/cancel commands;
2. complete due operations;
3. start natural recovery for due active faults;
4. process due scenario steps in sequence order, subject to their guards;
5. complete due fault recoveries;
6. resolve runs with no active/recovering fault and no valid future step;
7. expire runs that reached `max_duration_seconds` and are still unresolved;
8. purge expired transient journals and recordings.

If two transitions occur at the same timestamp, this order is authoritative.
For example, a completed `restore_dhcp` action resolves the DHCP root fault
before a DNS symptom step is evaluated, allowing that guarded symptom step to
be skipped.

### Durable control store and outbox

`control.db` contains incident runs, faults, operations, idempotency records,
dispatcher lease, transient journals, and an `event_outbox` table. A dispatcher
transition and its outbox rows commit in one SQLite transaction. Every outbox
row carries exactly one `visibility_scope`: `base`, `transient`, or `recording`,
plus `run_id` where applicable.

`OutboxPublisher` broadcasts sanitized outbox events idempotently by
`event_id`. It writes only `base` events to `events.db`, whose `event_id` is
unique. It writes a `recording` event to the immutable `recordings.db` record
identified by `(recording_id, event_id)`. It never writes a `transient` event
to `events.db`: the transient journal supplies it to `GET /api/events` until
that journal is purged. A publisher restart resumes outstanding non-discarded
rows; a reset or expiry discards transient rows before they can be published.
This gives an incident one event owner at every point and prevents transient
events from leaking into long-lived public history.

On startup, the dispatcher:

1. reacquires the lease;
2. reloads all non-terminal runs and non-terminal operations;
3. advances them to `Clock.now()` using the precedence rules above;
4. republishes unacknowledged, non-discarded outbox rows;
5. exposes `dispatcher_last_success_at`, `dispatcher_lease_held`, and
   `outbox_pending_count` through private diagnostics and a sanitized
   liveness summary through `/health`.

No cross-database transaction is assumed. The outbox provides at-least-once
delivery; `event_id` deduplication makes public event delivery effectively
once-only. `GET /api/events` returns base events from `events.db` merged with
non-expired, non-discarded transient journal events; it de-duplicates only by
the composite source key `(scope, event_id)` so independent simultaneous runs
cannot hide each other's evidence.

## 5. Total run and fault lifecycle

### Fault rules

- A fault begins in `scheduled`.
- A due `StartFaultStep` changes it to `active` only if all
  `requires_active_fault_ids` are active at that dispatcher tick.
- An action can alter only faults that are active when the action completes.
- An action can set an active fault's `effect_multiplier_by_classifier`, begin
  recovery, or leave it unchanged, according to its action policy.
- `rogue_ap_present` and its dependent `rf_interference` fault each persist the
  same `attributes["bssid"]` value. `isolate_rogue_ap` selects only active
  faults with that exact normalized lowercase BSSID; it leaves faults from a
  different rogue AP unchanged.
- Natural recovery changes an active fault to `recovering` at
  `natural_recovery_at`.
- A recovering fault changes to `resolved` when its recovery curve reaches
  zero.
- Reset/cancel changes scheduled, active, and recovering faults to
  `cancelled` immediately.
- A fault cannot return to an earlier state.

### Run rules

- A new run is `pending` until its first fault becomes active.
- It is `active` while at least one fault is active.
- It is `recovering` when no fault is active and at least one fault is
  recovering.
- It is `resolved` when all faults are terminal and no valid future step
  remains.
- It is `expired` when maximum duration is reached before resolution; all
  remaining faults are cancelled.
- It is `cancelled` after private cancel/reset.
- `resolved`, `expired`, and `cancelled` are terminal and immutable.

V1 forbids independent delayed root faults. Every delayed `StartFaultStep`
must name at least one `requires_active_fault_ids` guard. This eliminates the
ambiguous case of a new fault beginning after full recovery.

There is no `/complete` endpoint in V1. `cancel` stops a run and preserves its
journal for the normal 15-minute diagnostic window. `reset` stops a run and
purges its transient journal immediately. Both are idempotent; repeated calls
return the same terminal state.

## 6. Fault schema and overlay details

`FaultInstance` has one amplitude layer per affected classifier:

```text
effective amplitude = template amplitude
                    × severity multiplier
                    × action multiplier for that classifier
                    × impact progress
                    × recovery progress
```

`impact_duration_seconds` is required. For `immediate`, it is `0` and impact
progress is `1` at `starts_at`. For `linear_ramp`, it must be greater than zero
and impact progress rises linearly from `0` to `1` over that duration.

When a fault begins recovery, compute and persist `frozen_impact` as the
impact progress at `recovery_started_at`; do not continue a ramp while the
recovery curve runs. `recovery_progress` is `1.0` until recovery starts and
then follows the declared curve. The implementation therefore evaluates a
recovering fault as `template amplitude × severity × action multiplier ×
frozen_impact × recovery_progress`. This is the sole V1 rule when remediation
or natural recovery begins partway through a ramp.

`effect_multiplier_by_classifier` starts at `1.0`. A partial remediation may
set one or more entries to `0.4`; that change persists until normal recovery or
terminal cancellation. Multiple faults add their effects before the observed
classifier is clamped to `0..1`.

Clamping guarantees valid values but does not guarantee that overlapping faults
remain individually distinguishable when a classifier saturates. Public events
and affected-resource telemetry provide the observable evidence of concurrent
incidents. Tests must cover saturation and assert bounded values rather than
asserting all overlaps remain numerically separable.

## 7. Typed topology and catalog validation

V1 target selectors are exactly:

| Selector | Resolution |
|---|---|
| `target` | explicitly selected AP resource |
| `action_resource` | resource named by the action that created this fault; valid only for an operation-owned fault |
| `same_floor_peers` | APs with the same `floor` topology property, excluding target |
| `all_aps` | all six APs |
| `dependency:<resource_id>` | one named shared resource in the topology |
| `explicit:<resource_id>[,<resource_id>...]` | listed resources only |

The new topology catalog defines each AP's floor, its shared dependencies, and
the resource inventory named earlier in this document. `SW-DIST-01` is a
dependency of every AP. `DHCP-01`, `DNS-01`, and `RADIUS-01` are service
dependencies of every AP. `RF-SEC-01` is the security-management resource for
all APs.

The canonical v1 fault templates are:

| Fault type | Resource selector | Classifier effects at critical severity |
|---|---|---|
| `dhcp_service_unavailable` | `target` | `dhcp: -0.35` |
| `dns_retry_pressure` | `target` | `dns: -0.20` |
| `distribution_uplink_failure_target` | `target` | `uptime: -0.50`, `cpu: -0.20` |
| `distribution_uplink_failure_peer` | `same_floor_peers` | `client_density: -0.15`, `airtime_utilization: -0.12` |
| `rogue_ap_present` | `target` | `cell_overlap: -0.30`, `retry_rate: -0.25` |
| `rf_interference` | `target` | `cochannel_interference: -0.30`, `cca_busy: -0.25`, `retry_rate: -0.20`, `signal_strength: -0.15` |
| `firmware_regression` | `target` | `uptime: -0.35`, `cpu: -0.20` |
| `client_surge` | `target` | `client_density: -0.25`, `airtime_utilization: -0.20` |
| `ap_restart_disturbance` | `action_resource` | `uptime: -0.25`, `cpu: -0.10` |

At process startup, catalog validation must reject an unknown selector,
resource, classifier, fault type, event type, action, curve, or dependency
reference. The backend must fail readiness rather than run with a partially
valid catalog.

Catalog validation also requires `rogue_ap_present` and `rf_interference` to
declare a `bssid` attribute schema. The dispatcher copies the deterministic
generated BSSID from the root rogue fault into its dependent interference fault
before either becomes observable, and indexes `(state, attributes.bssid)` in
`control.db` for matching remediation.

## 8. Stable capabilities and exact action contract

Use `resource` consistently in routes, data models, messages, and UI labels.
Capabilities are static by resource type; they do not change because an
incident is currently active. This prevents them from revealing the correct
diagnosis.

| Resource type | Supported action | Required request body | Operation duration | Fault consequence |
|---|---|---|---:|---|
| access point | `restart` | `{}` | 60s | starts a 60-second `ap_restart_disturbance` when accepted; it does not resolve DHCP, switch, rogue, or firmware faults |
| access point | `change_channel` | `{"channel": 1|6|11|36|40|44|149|153|157}` | 30s | reduces active `rf_interference` effect multiplier to `0.4`; does not resolve `rogue_ap_present` |
| access point | `rebalance_clients` | `{}` | 60s | reduces active `client_surge` multiplier to `0.4`; has no lasting effect on switch fault peers |
| access point | `rollback_firmware` | `{}` | 120s | starts recovery of active `firmware_regression`, then emits normal `device_restarting` and `device_restart_complete` lifecycle events |
| DHCP service | `restore_dhcp` | `{}` | 45s | starts recovery of active `dhcp_service_unavailable` and active dependent `dns_retry_pressure` faults |
| distribution switch | `failover_uplink` | `{}` | 90s | starts recovery of active distribution-uplink target and peer faults |
| RF security service | `isolate_rogue_ap` | `{"bssid": "aa:bb:cc:dd:ee:ff"}` | 60s | starts recovery of active `rogue_ap_present` and active `rf_interference` faults with matching BSSID |

Each `parameters` schema rejects additional properties. The request envelope
is exactly `{action, parameters}`; `Idempotency-Key` and optional
`X-Correlation-ID` are HTTP headers, never action parameters. The `bssid` for
a rogue AP is included in the public detection event. A correct action can
therefore be reasoned from observations without exposing internal fault names.

Actions affect all matching active faults on the targeted resource and its
declared dependent scope. This is deliberate: restoring the one DHCP service
can resolve several concurrent DHCP incidents, just as a shared real service
repair can help multiple sites. `Operation.affected_run_ids` records every run
changed by that action; the public operation response does not diagnose them.
Instead, the dispatcher emits one normal correlated event for each affected
incident. A valid but irrelevant action completes with a normal operational
result and produces no fault transition.

The public action request uses a standard `Idempotency-Key` HTTP header. Its
uniqueness scope is `(authenticated_principal, Idempotency-Key)` for 24 hours.
The server stores a canonical JSON request hash. A replay with the same hash
returns the original operation response; a different hash returns `409
idempotency_conflict`. Local development uses the configured local principal;
deployment requires an API key or equivalent authenticated principal before
public action endpoints are enabled.

`GET /api/operations/{operation_id}` returns `404 operation_not_found` for a
missing operation and `403 operation_forbidden` when the caller lacks access to
the operation's principal scope.

For `restart`, the operation-owned `ap_restart_disturbance` starts at operation
acceptance and resolves exactly when the 60-second operation completes. A
restart is therefore observable as ordinary temporary device impact without
needing an incident run. Firmware rollback produces its lifecycle events at
completion but does not create a second restart disturbance; its 120-second
operation duration already represents the modeled disruption.

## 9. Scenario definitions for the initial matrix

The following steps replace ambiguous event-only descriptions. Durations below
are from scenario start and use critical severity; warning multiplies each
amplitude by `0.70` while keeping the same schedule.

Every listed `StartFaultStep` uses `impact_curve: immediate` and
`impact_duration_seconds: 0`. No initial V1 scenario uses a ramp. Each listed
natural-recovery duration is the fault's `recovery_duration_seconds`; DHCP and
other remediation actions use that same recovery curve and duration when they
begin recovery early. The target is always the one AP provided to the private
create request, and all peer/shared-resource effects resolve through the typed
selector table.

This table is the complete compiler input for initial-fault curves and timing.
`requires` is evaluated at the fault's stated start time; an empty value means
the fault starts unconditionally.

| Scenario | Fault type | Start | Requires | Impact curve / duration | Recovery curve / duration | Natural recovery starts |
|---|---|---:|---|---|---|---:|
| DHCP outage | `dhcp_service_unavailable` | 0s | — | immediate / 0s | linear / 120s | 900s |
| DHCP outage | `dns_retry_pressure` | 180s | active `dhcp_service_unavailable` | immediate / 0s | linear / 60s | 900s |
| Major switch failure | `distribution_uplink_failure_target` | 0s | — | immediate / 0s | exponential / 180s | 1,800s |
| Major switch failure | `distribution_uplink_failure_peer` | 0s | — | immediate / 0s | exponential / 180s | 1,800s |
| Rogue AP attack | `rogue_ap_present` | 0s | — | immediate / 0s | linear / 120s | 1,200s |
| Rogue AP attack | `rf_interference` | 150s | active `rogue_ap_present` with same BSSID | immediate / 0s | linear / 120s | 1,200s |
| Firmware rollout failure | `firmware_regression` | 0s | — | immediate / 0s | linear / 120s | 1,200s |
| High-density surge | `client_surge` | 0s | — | immediate / 0s | linear / 120s | 1,800s |

### DHCP outage (`max_duration_seconds: 1020`)

1. `0s`: start `dhcp_service_unavailable` on `target`; natural recovery starts
   at `900s` and lasts `120s`.
2. `180s`: start `dns_retry_pressure` on `target` only if the DHCP fault is
   still active; natural recovery starts at `900s` and lasts `60s`.
3. `0s`: emit `dhcp_service_degraded` event from `DHCP-01` related to target.
4. `180s`: emit `dns_resolution_degraded` only if its guarded fault started.

`restore_dhcp` starts recovery for both active faults after the operation
completes. `restart` on the AP is intentionally ineffective.

### Major switch failure (`max_duration_seconds: 1980`)

1. `0s`: start target and same-floor peer distribution-uplink faults; natural
   recovery starts at `1,800s` and lasts `180s`.
2. `0s`: emit `distribution_uplink_unreachable` from `SW-DIST-01` related to
   target and peers.

`failover_uplink` starts recovery of both fault types after operation
completion. `rebalance_clients` on a peer is intentionally ineffective.

### Rogue AP attack (`max_duration_seconds: 1320`)

1. `0s`: start `rogue_ap_present` on target with a deterministic generated
   BSSID; natural recovery starts at `1,200s` and lasts `120s`.
2. `0s`: emit `rogue_access_point_detected` containing that BSSID.
3. `150s`: start `rf_interference` on target only while the rogue fault is
   active; natural recovery starts at `1,200s` and lasts `120s`.

`isolate_rogue_ap` with the detected BSSID starts recovery of both active
faults. `change_channel` reduces only RF-interference amplitude.

### Firmware rollout failure (`max_duration_seconds: 1320`)

1. `0s`: start `firmware_regression` on target; natural recovery starts at
   `1,200s` and lasts `120s`.
2. `0s`: emit `firmware_health_regression` from target.

`rollback_firmware` starts recovery after completion and emits an ordinary
restart event. `restart` alone does not resolve the firmware fault.

### High-density surge (`max_duration_seconds: 1920`)

1. `0s`: start `client_surge` on target; natural recovery starts at `1,800s`
   and lasts `120s`.
2. `0s`: emit `client_density_elevated` from target.

`rebalance_clients` reduces the active multiplier to `0.4`; it does not remove
the remaining surge. Natural recovery clears the rest.

## 10. Migration and failure tests

### Schema migration

Add versioned migrations for `control.db`, `recordings.db`, and `events.db`.
Migrations must be forward-only and each has a schema-version row. Deployment
startup fails readiness when a required migration has not completed.

`events.db` migration adds `event_id` (backfilled UUID for legacy rows),
`incident_id`, `correlation_id`, `related_resources_json`, and a unique index
on `event_id`. Legacy rows receive `legacy: true` in internal metadata and are
excluded from default public event queries. A private diagnostic query may
include them.

No migration rewrites metric values. Base metrics continue to be treated as
clean from the V1 cutover forward. The deployment runbook requires a fresh
baseline/bootstrap after cutover to remove marker-only legacy events from the
default experience.

### Required failure and concurrency tests

Automate these tests in addition to the existing unit and integration suite:

- process restart after control transaction commit but before outbox publish
- process restart after event-store write but before outbox acknowledgement
- duplicate dispatcher invocation with an expired lease
- reset racing an operation completion at the same clock timestamp
- action completion racing natural recovery and a guarded symptom step
- recovery completion exactly at `max_duration_seconds` resolves rather than
  expires because resolution precedes expiration
- restart after downtime processes each due timestamp in order; a run whose
  deadline precedes its recovery completion expires even if both are overdue
- recovery beginning during a linear impact ramp starts from the persisted
  `frozen_impact` and never increases again
- duplicate and conflicting idempotency-key requests
- two concurrent DHCP incidents resolved by one shared DHCP service action
- action that resolves multiple runs creates one operation with multiple
  private `affected_run_ids` and one public correlated event per incident
- rogue detection event exposes a valid BSSID and the matching isolation action
  resolves only faults with that BSSID
- public HTTP and WebSocket schema snapshots proving forbidden internal terms
  are absent
- route-inventory test proving every router, WebSocket publisher, and generated
  API-documentation entry is present in `api_surface_manifest` with its intended
  audience
- transient journal expiry proving later public history is clean
- reset and journal expiry discard transient outbox rows and leave no matching
  row in `events.db`
- transient-journal capacity, action-attempt capacity, and event-row capacity
  reject excess work with the defined response and never exceed logical caps
- recording query proving captured history remains available after transient
  journal expiry
- deterministic replay with fixed clock, clean snapshot, seed, and action
  request sequence
- deterministic replay repeats safely after journal removal, rejects a
  concurrent duplicate tuple, and never collides with base-event IDs
- concurrent deterministic runs on one AP share the instance clean frame,
  combine only through declared overlays, and preserve independent state and
  event/operation identities
- private test-clock API rejects wall-clock production mode and advances all
  due transitions synchronously in deterministic-test mode
- reset after resolved, expired, and cancelled states preserves the terminal
  state while correctly reporting whether a transient journal was purged
- cancel after active and terminal states preserves the stated diagnostic-window
  behavior without changing an immutable terminal state
- action acceptance produces one `operation_started` event and an immediate
  operation read returns the defined `in_progress` state

The baseline quality gate compares a canonical semantic hash of baseline
distributions under a frozen clock. It does not compare raw artifact bytes.

## 11. Bounded implementation acceptance checklist

This is the final planning gate. It converts the plan into a finite review
surface: a reviewer may identify a P0 only when a row has no authoritative
rule, has two conflicting rules, or cannot be verified by its stated check.
New feature ideas and hypothetical P2 refinements go to a later backlog rather
than reopening this V1 plan.

| # | Requirement | Authoritative plan location | Acceptance evidence |
|---:|---|---|---|
| 1 | Every public/private route is classified and public payloads reveal no simulator internals. | §1 API exposure matrix and route-inventory rule | API-manifest/router/docs inventory test plus HTTP and WebSocket schema snapshots |
| 2 | A V1 run has one AP target and derives all other scope from typed topology. | Private test-control API; §7 | create-request validation tests |
| 3 | All five scenarios have complete fault timing, curves, guards, and duration ceilings. | §9 timing table and scenario subsections | catalog compiler test |
| 4 | Clean baseline state is never mutated by an incident. | Overlay algorithm; §6 | before/after clean-snapshot regression |
| 5 | Overlapping overlays add, clamp, and clear independently. | Overlay algorithm; §6 | overlap and saturation tests |
| 6 | Mid-ramp recovery uses persisted `frozen_impact`. | §6 | curve sampling test |
| 7 | A run reaches exactly one immutable terminal state. | §5 | lifecycle state-machine test |
| 8 | Reset/cancel has defined behavior for active and terminal runs. | Private test-control API; §5 | reset-and-cancel state matrix test |
| 9 | A deadline wins over later recovery after a process outage. | §4 chronological `advance_to` | restart-after-deadline test |
| 10 | One dispatcher lease owner performs every transition in timestamp order. | §4 | duplicate-lease and catch-up tests |
| 11 | Each event has exactly one storage owner and transient events never enter base history. | §2; §4 outbox | reset/expiry and restart-outbox tests |
| 12 | Recordings preserve causal output without modifying live base history. | §2 | private recording-query test |
| 13 | Actions have strict request schemas, idempotency, start timing, and normal operational wording. | Operations lifecycle; Public monitoring API; §8 | action contract tests |
| 14 | A shared action can affect multiple incidents without exposing diagnosis in its operation response. | §8 | multi-run DHCP repair test |
| 15 | Rogue detection supplies a BSSID and isolation affects only matching persistent fault attributes. | §5; §7; §8; §9 | BSSID matching test |
| 16 | Restart and firmware rollback have defined observable lifecycle effects. | §8 | operation-event/overlay test |
| 17 | Deterministic mode uses one shared instance baseline and reproducible run-specific randomness, including a specified concurrent run set. | §3 | concurrent deterministic-run replay test |
| 18 | Deterministic clock control is private, explicit, and has no wall-clock production dependency. | Private test-control API; §3 | clock API integration test |
| 19 | Correlation ID precedence is identical in action HTTP results and event transports. | Public monitoring API | correlation schema test |
| 20 | Repeated create/reset cycles leave no drift or leaked overlays, and transient logical storage stays within defined caps then reaches zero after expiry. | §2 bounded transient storage; Verification plan; required failure tests | accelerated soak plus per-run expiry-count assertions |

Implementation may begin when a final bounded review marks every row complete
or explicitly defers it as a P2 with no effect on another row. Zero P0s and
zero unresolved P1s are required. The implementer must preserve this checklist
and attach each acceptance test to its numbered row.
