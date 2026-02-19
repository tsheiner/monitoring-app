# Classifier Architecture Plan

## Agent Execution Companion

For implementation in portable, task-oriented format, use:
- [Classifier Architecture TDD Playbook](factor-decomposition-tdd-playbook.md)

## Goal

Add domain-specific sub-component classifiers to each metric so that the simulator produces not just a metric value but a breakdown of *why* the metric is at that value. When a metric degrades, the classifier breakdown reveals which sub-component is responsible — enabling root-cause analysis UX like the [proposed assurance overview](references/assuranceOverview_Proposed.png).

Each classifier is always instrumented with its own value and health status (green/yellow/red), visible during both healthy and degraded states.

## Inspiration

Proposed Assurance Overview shows metrics like "Successful Connects: 80%" with a breakdown:
- Association: 5%
- Authorization: 3%
- DHCP: 92% ← primary contributor (red)
- DNS: 0%

The key insight: because the metric is computed from known sub-processes, and each sub-process has a known normal range, degradation can be attributed to specific root causes automatically.

## Current Architecture

```
value = daily_profile(hour) + OU_noise × weight × range + Σ(sensitivity × driver_deviation) × range
```

Three shared drivers (client_load, rf_quality, infra_health) provide weak cross-metric correlation. Perturbations target these drivers, and metrics derive from them indirectly. There is no sub-component or classifier concept — each metric produces a single scalar value.

## Proposed Architecture

### New Layer: Classifiers

Insert a **classifier layer** between events/perturbations and metrics:

```
event → perturbation → classifier(s) → metric
```

Classifiers are the **simulation primitive** — they are the source of stochastic variation. Metric values are derived consequences.

Each metric is defined as a function of 2-4 domain-specific classifiers. Each classifier:
- Has its own OU process (value fluctuates naturally)
- Is simulated during bootstrap; its normal range and thresholds (green/yellow/red) are derived from observed bootstrap percentiles
- Can be targeted by perturbations directly
- Contributes to the parent metric via a defined weight
- May be shared across metrics (e.g., a single DHCP OU process affects both successful_connects and time_to_connect)

### Classifier Definitions Per Metric

| Metric | Classifiers | Rationale |
|--------|-------------|-----------|
| **successful_connects** | Association, Authorization, DHCP, DNS | The four stages of a WiFi connection. Each can fail independently. |
| **time_to_connect** | Association latency, Auth latency, DHCP latency, DNS latency | Same four stages but measuring time, not success rate. |
| **capacity** | Client density, Co-channel interference, Non-WiFi interference | Capacity is consumed by traffic and degraded by interference. |
| **throughput** | Airtime utilization, Channel width, Retry rate | Throughput depends on how efficiently the air is used. |
| **coverage** | Signal strength, AP density, Cell overlap | RF coverage is a spatial/physical property. |
| **roaming** | Handoff latency, RSSI threshold tuning, 802.11r/k support | Roaming quality depends on protocol support and tuning. |
| **ap_health** | CPU utilization, Memory pressure, Uptime/crashes, Temperature | Hardware and software health indicators. |

### Classifier → Metric Computation

Each classifier has:
- `value`: current state (0.0–1.0 normalized, where 1.0 = perfect)
- `weight`: how much this classifier contributes to the parent metric
- `normal_range`: [low, high] derived from bootstrap percentiles (what the simulation actually produced as "normal")
- `degraded_threshold`: derived from bootstrap (e.g., below p10 → yellow)
- `critical_threshold`: derived from bootstrap (e.g., below p2 → red)

The metric value is computed as:

```
metric_value = daily_profile(hour) + Σ(classifier_weight × classifier_deviation × metric_range)
```

Where `classifier_deviation = classifier_value - classifier_normal_level`.

During bootstrap: classifier OU processes run as the primitive layer. Metrics are computed from classifiers (+ daily profile) every tick. At the end, distributions are computed for *both* metrics and classifiers from what was actually observed. Classifier thresholds are derived from bootstrap percentiles, ensuring consistency — a classifier value that the simulation regularly produces during healthy operation will never be incorrectly flagged as degraded.

During healthy operation: all classifiers are near their normal levels, deviations are small, the metric tracks its daily profile with gentle noise.

During degradation: one or more classifiers deviate significantly, pulling the metric away from its profile. The classifier with the largest `|weight × deviation|` is the primary contributor.

### Classifier Status (Always Visible)

Each classifier always reports:
- **value**: current level (e.g., DHCP success rate: 0.94)
- **status**: green (normal) / yellow (degraded) / red (critical) — thresholds derived from bootstrap distributions
- **contribution**: how much this classifier is pulling the metric away from its expected value, as a signed offset in metric units

During steady state, all classifiers show green with small contributions — the admin sees "everything nominal" at a glance. During degradation, one or two classifiers go yellow/red and dominate the contribution breakdown.

### Perturbation Retargeting

Currently, perturbations affect shared drivers:
```python
# Current
"device_crash": { "affected_metrics": { "infra_health": -0.40 } }
```

New: perturbations target shared classifier names directly:
```python
# Proposed
"dhcp_server_overload": {
    "affected_classifiers": {
        "dhcp": -0.35,  # shared classifier — cascades to all metrics that reference it
    },
    "duration_seconds": 180,
    "decay_type": "exponential",
}

"device_crash": {
    "affected_classifiers": {
        "uptime": -0.50,
        "cpu": -0.20,
        "client_density": -0.10,
    },
    "duration_seconds": 120,
    "decay_type": "exponential",
}
```

Key point: classifier names are flat, not namespaced by metric (no dot-notation). `"dhcp"` is the shared DHCP OU process — targeting it automatically degrades every metric that references `dhcp` with its defined weight. You never need to list `successful_connects.dhcp` and `time_to_connect.dhcp` separately; the cascade is a structural consequence of the shared pool. The attribution is automatic — it falls out of the architecture.

### Environmental Conditions vs. Classifiers

There are two distinct categories in the simulation:

**Environmental conditions** are exogenous — they come from outside the WiFi system. The primary one is **`client_load`**: a model of diurnal human activity (people are awake during the day, asleep at night). It has a strong daily cycle and affects everything broadly. It is not something that "breaks" — it's a load condition.

**Classifiers** are endogenous — they represent the state of infrastructure sub-components (DHCP, DNS, association, etc.) that can degrade or fail. They are the things you diagnose and fix.

The existing `rf_quality` and `infra_health` drivers are retired — they were vague statistical proxies for what classifiers now model explicitly. Classifier sharing across metrics (e.g., a single DHCP OU process affecting both successful_connects and time_to_connect) provides domain-correct cross-metric coupling, replacing the statistical correlation that shared drivers provided.

`client_load` survives as the sole environmental condition. It modulates classifier behavior (more clients → more DHCP requests → more chances for DHCP to degrade) and feeds the daily profile backbone.

### Event Templates (Revised)

| Event | Classifiers Targeted | Cascade (metrics affected automatically) |
|-------|---------------------|-----------------------------------------|
| `dhcp_server_overload` | `dhcp` | successful_connects, time_to_connect |
| `radius_timeout` | `authorization` | successful_connects, time_to_connect |
| `dns_resolution_failure` | `dns` | successful_connects, time_to_connect |
| `interference_event` | `cochannel_interference`, `retry_rate`, `signal_strength` | capacity, throughput, coverage |
| `device_crash` | `uptime`, `cpu`, `client_density` | ap_health, capacity |
| `firmware_update` | `uptime`, `cpu` | ap_health |
| `channel_change` | `channel_width`, `rssi_tuning` | throughput, roaming |
| `high_density_event` | `client_density`, `airtime_utilization` | capacity, throughput |
| `rogue_ap` | `cell_overlap`, `retry_rate` | coverage, throughput |
| `heat_event` | `temperature`, `cpu` | ap_health |

## Data Model Changes

### Observation Model

Extend `MetricObservation` to include classifier breakdown:

```python
class ClassifierStatus(BaseModel):
    name: str                    # e.g., "dhcp"
    value: float                 # current classifier value (0-1)
    status: str                  # "green" | "yellow" | "red"
    contribution: float          # offset in metric units (signed)
    weight: float                # classifier weight in metric formula

class MetricObservation(BaseModel):
    timestamp: int
    metric: str
    value: float
    entity: Optional[str] = None
    classifiers: Optional[List[ClassifierStatus]] = None  # NEW
```

The `classifiers` field is optional for backward compatibility. Older consumers can ignore it; new UX can use it for decomposition views.

### API Endpoint

Add or extend the metrics API to expose classifier data:

```
GET /api/metrics/{metric}/observations  → includes classifiers[] in each observation
GET /api/metrics/{metric}/classifiers   → current classifier states for the metric
```

The WebSocket feed should also include classifier data in real-time observations.

### Config Extension

Config defines classifier OU parameters and weights. Thresholds are NOT in config — they are derived from bootstrap.

```json
{
  "classifiers": {
    "dhcp": {
      "ou_theta": 0.0003,
      "ou_sigma": 0.0006,
      "initial_level": 0.99,
      "description": "DHCP lease acquisition success rate"
    },
    "dns": {
      "ou_theta": 0.0002,
      "ou_sigma": 0.0004,
      "initial_level": 0.995,
      "description": "DNS resolution success rate"
    },
    "association": {
      "ou_theta": 0.0003,
      "ou_sigma": 0.0008,
      "initial_level": 0.98,
      "description": "802.11 association success rate"
    },
    "authorization": {
      "ou_theta": 0.0004,
      "ou_sigma": 0.0010,
      "initial_level": 0.97,
      "description": "RADIUS/802.1X auth success rate"
    }
  },
  "metrics": {
    "successful_connects": {
      "baseline": 98.2,
      "min": 94,
      "max": 99.8,
      "classifiers": {
        "association": { "weight": 0.20 },
        "authorization": { "weight": 0.25 },
        "dhcp": { "weight": 0.40 },
        "dns": { "weight": 0.15 }
      }
    },
    "time_to_connect": {
      "baseline": 1.8,
      "min": 0.8,
      "max": 5.0,
      "classifiers": {
        "association": { "weight": 0.20 },
        "authorization": { "weight": 0.25 },
        "dhcp": { "weight": 0.40 },
        "dns": { "weight": 0.15 }
      }
    }
  }
}
```

Note: classifiers are defined once at the top level (shared pool), and metrics reference them by name with weights. The same `dhcp` classifier drives both `successful_connects` and `time_to_connect`. Thresholds (green/yellow/red) are computed during bootstrap from observed classifier distributions and stored in `baselines.json` alongside metric baselines.

## Implementation Phases

### Phase 1: Classifier Simulation Engine

**Goal**: Classifiers exist and are simulated as the stochastic primitive, metrics derive from them. Legacy abstract drivers removed (except `client_load`).

1. Define shared classifier pool: identify classifiers referenced by multiple metrics (e.g., DHCP, interference) and create a single OU process for each unique classifier
2. Define `CLASSIFIER_DEFINITIONS` config with all classifier OU params and descriptions
3. Define `METRIC_CLASSIFIERS` mapping: which classifiers each metric depends on, with weights
4. Add per-classifier OU processes to `RealisticGenerator` (shared pool, not per-metric)
5. Rewrite `_derive_metric()`: `value = daily_profile(hour) + Σ(classifier_weight × classifier_deviation × metric_range)`
6. Remove abstract driver infrastructure: `DRIVER_DEFAULTS` (rf_quality, infra_health only), `METRIC_SENSITIVITIES`, `_update_drivers()`, `_driver_mean()`, associated OU state. **Keep `client_load`** as an environmental condition with its daily cycle.
7. Remove `METRIC_OU_NOISE` (replaced by classifier OU processes)
8. Extend bootstrap to track classifier values alongside metric values; compute per-classifier hourly distributions
9. Store classifier baselines in `baselines.json`; derive classifier thresholds (green/yellow/red) from bootstrap percentiles
10. Validate: bootstrap still produces sensible baselines, daily profiles preserved, classifier thresholds align with observed metric behavior

**Key constraint**: Classifiers are the simulation primitive — they are the source of stochastic variation, and metric values are derived consequences. The bootstrap captures the joint truth of classifiers and metrics together, ensuring thresholds are consistent with what the simulation actually produces.

### Phase 2: Perturbation Retargeting

**Goal**: Events affect classifiers, not shared drivers.

1. Redefine `PERTURBATION_TEMPLATES` to target classifier names directly (e.g., `"dhcp": -0.35`)
2. Update `Perturbation` dataclass: `affected_classifiers: Dict[str, float]` replaces `affected_metrics`
3. Update `PerturbationManager.total_effect()` to resolve classifier names from the shared pool
4. Apply perturbation effects to classifier OU processes (push classifier away from normal)
5. Rewrite event templates for the new classifier vocabulary (dhcp_server_overload, radius_timeout, etc.)
6. Update load pattern templates similarly
7. Validate: events create visible classifier degradation that cascades to all dependent metrics

### Phase 3: API Exposure

**Goal**: Classifier data available to consumers.

1. Add `ClassifierStatus` model to `models.py`
2. Extend `MetricObservation` with optional `classifiers` field
3. Update `generate_observation()` to compute and include classifier breakdown per metric
4. Extend HTTP API endpoint to return classifier data
5. Include classifier data in WebSocket real-time feed
6. Validate: API consumers receive classifier breakdown with every observation

### Phase 4: Classifier Baseline API

**Goal**: Expose classifier baselines to consumers.

1. Add API endpoints for classifier baseline distributions (per-classifier hourly percentiles)
2. Expose classifier baselines via HTTP API alongside metric baselines
3. Include classifier baseline data in relevant WebSocket messages

Note: Classifier baselines are *computed* in Phase 1 (as part of the bootstrap). This phase is about *exposing* them through the API. It can be done alongside or after Phase 3.

### Phase 5: Classifier UI — Crosshair Tooltip

**Goal**: Surface classifier data to the user via a chart crosshair tooltip. The left sidebar remains unchanged — it continues to serve its existing role as metric identity/toggle/chart legend.

**Reference mock**: `docs/references/classifierTooltip.png` (pending)

#### Tooltip behavior

When the cursor is inside the chart area:
- A vertical crosshair line tracks cursor x (= time coordinate)
- A horizontal hairline tracks cursor y
- A tooltip appears showing, for every visible metric, its value at the cursor's time position
- The metric **nearest the cursor's y position** is the "active" metric — its classifier breakdown is expanded inline in the tooltip; all other metrics show name + value only

#### Tooltip content (active metric section)

For the active metric, below the metric name + value, list each classifier on its own row:
- Classifier name
- Current value (e.g., `0.982`)
- Status indicator: green / yellow / red dot, derived from bootstrap thresholds

No contribution bars, no percentages — value + status is sufficient and always meaningful regardless of whether the metric is in or out of range.

The primary contributor (classifier in worst status, or if tied, highest `|weight × deviation|`) is visually distinguished — bold name or slightly more prominent status dot.

#### Active metric selection with hysteresis

Naively tracking the instantaneous nearest metric causes rapid tooltip cycling when metrics are close together. Instead:

- Track `activeMetric` as stable state, separate from the live nearest-metric computation
- On each mousemove, compute which metric line is nearest to cursor y at cursor x
- If nearest ≠ `activeMetric`, start a debounce timer (~150ms)
- If nearest changes again before the timer fires, reset the timer
- Only update `activeMetric` when the timer fires — i.e., cursor has been stably closer to a different metric for the full debounce window

This means transient cursor passes near another metric do not trigger a swap. Only deliberate repositioning does.

#### Interaction states
- **Hover**: crosshair + tooltip visible
- **Pan (click-drag)**: crosshair and tooltip suppressed; drag gesture owns the interaction entirely
- **Live edge**: when streaming live data, suppress or freeze tooltip for the rightmost portion of the chart that is still being filled

#### Frontend files affected
- `frontend/src/chart/ChartView.ts` — mousemove handler, crosshair rendering, active metric state + hysteresis timer
- `frontend/src/chart/types.ts` — extend `Observation` with optional `classifiers` field
- `frontend/src/main.ts` — tooltip DOM element management
- `frontend/index.html` — tooltip container element (if not already present)

## Design Decisions (Resolved)

1. **Classifier sharing across metrics**: Classifiers that represent the same infrastructure (e.g., DHCP) are **shared OU processes** referenced by multiple metrics. A single DHCP state drives both successful_connects and time_to_connect. These are facts about the real world — they affect all metrics to which they are relevant. A perturbation to the DHCP classifier simultaneously and causally degrades all dependent metrics.

2. **Daily profiles stay at metric level**: The existing hand-crafted per-metric daily profiles are preserved as the deterministic backbone. Classifiers provide only the stochastic/perturbation layer on top. In theory, if real data became available for a metric's daily shape, we'd swap that in — the classifier math stays the same. The formula becomes: `value = daily_profile(hour) + Σ(classifier_weight × classifier_deviation × metric_range)`.

3. **Environmental conditions vs. classifiers**: `client_load` is kept as a separate environmental condition — it models diurnal human activity ("people are diurnal") and is not something that breaks or gets diagnosed. `rf_quality` and `infra_health` are removed — they were abstract statistical proxies for what classifiers now model with domain-correct causality. Classifier sharing across metrics provides the cross-metric coupling that shared drivers previously provided.

4. **Classifier thresholds from bootstrap, not config**: The bootstrap creates the simulated truth — 30 days of history defining what "normal" is. If classifiers drive metric values, then classifier values observed during bootstrap *are* the ground truth for normal classifier behavior. Hardcoding classifier ranges separately risks inconsistency: config could say "DHCP at 0.92 is yellow" while the bootstrap routinely produces DHCP at 0.90 as healthy. Classifiers are simulated during bootstrap, and thresholds are derived from observed percentiles — ensuring consistency between classifier health and metric health.

## Scope Estimate

| Phase | Effort | Files Modified |
|-------|--------|---------------|
| Phase 1: Classifier engine + bootstrap integration | Large | realistic_generator.py, bootstrap.py, config_enterprise.json (+ other configs) |
| Phase 2: Perturbation retargeting | Medium | perturbations.py, realistic_generator.py, event_generator.py |
| Phase 3: API exposure | Small-medium | models.py, http_api.py, websocket_server.py |
| Phase 4: Classifier baseline API | Small | http_api.py, websocket_server.py |
| Phase 5: Classifier UI — crosshair tooltip | Medium | ChartView.ts, types.ts, main.ts, index.html |

Total: ~4-5 working sessions. Phase 1 is the largest (classifier simulation, bootstrap integration, driver cleanup). Phases 3-4 could be combined. Phase 5 is frontend-only and can be developed independently once Phase 3 is complete.
