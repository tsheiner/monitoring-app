# Factor Decomposition Plan

## Goal

Add domain-specific sub-component factors to each metric so that the simulator produces not just a metric value but a breakdown of *why* the metric is at that value. When a metric degrades, the factor breakdown reveals which sub-component is responsible — enabling root-cause analysis UX like the [proposed assurance overview](references/assuranceOverview_Proposed.png).

Each factor is always instrumented with its own value and health status (green/yellow/red), visible during both healthy and degraded states.

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

Three shared drivers (client_load, rf_quality, infra_health) provide weak cross-metric correlation. Perturbations target these drivers, and metrics derive from them indirectly. There is no sub-component or factor concept — each metric produces a single scalar value.

## Proposed Architecture

### New Layer: Factors

Insert a **factor layer** between events/perturbations and metrics:

```
event → perturbation → factor(s) → metric
```

Factors are the **simulation primitive** — they are the source of stochastic variation. Metric values are derived consequences.

Each metric is defined as a function of 2-4 domain-specific factors. Each factor:
- Has its own OU process (value fluctuates naturally)
- Is simulated during bootstrap; its normal range and thresholds (green/yellow/red) are derived from observed bootstrap percentiles
- Can be targeted by perturbations directly
- Contributes to the parent metric via a defined weight
- May be shared across metrics (e.g., a single DHCP OU process affects both successful_connects and time_to_connect)

### Factor Definitions Per Metric

| Metric | Factors | Rationale |
|--------|---------|-----------|
| **successful_connects** | Association, Authorization, DHCP, DNS | The four stages of a WiFi connection. Each can fail independently. |
| **time_to_connect** | Association latency, Auth latency, DHCP latency, DNS latency | Same four stages but measuring time, not success rate. |
| **capacity** | Client density, Co-channel interference, Non-WiFi interference | Capacity is consumed by traffic and degraded by interference. |
| **throughput** | Airtime utilization, Channel width, Retry rate | Throughput depends on how efficiently the air is used. |
| **coverage** | Signal strength, AP density, Cell overlap | RF coverage is a spatial/physical property. |
| **roaming** | Handoff latency, RSSI threshold tuning, 802.11r/k support | Roaming quality depends on protocol support and tuning. |
| **ap_health** | CPU utilization, Memory pressure, Uptime/crashes, Temperature | Hardware and software health indicators. |

### Factor → Metric Computation

Each factor has:
- `value`: current state (0.0–1.0 normalized, where 1.0 = perfect)
- `weight`: how much this factor contributes to the parent metric
- `normal_range`: [low, high] derived from bootstrap percentiles (what the simulation actually produced as "normal")
- `degraded_threshold`: derived from bootstrap (e.g., below p10 → yellow)
- `critical_threshold`: derived from bootstrap (e.g., below p2 → red)

The metric value is computed as:

```
metric_value = daily_profile(hour) + Σ(factor_weight × factor_deviation × metric_range)
```

Where `factor_deviation = factor_value - factor_normal_level`.

During bootstrap: factor OU processes run as the primitive layer. Metrics are computed from factors (+ daily profile) every tick. At the end, distributions are computed for *both* metrics and factors from what was actually observed. Factor thresholds are derived from bootstrap percentiles, ensuring consistency — a factor value that the simulation regularly produces during healthy operation will never be incorrectly flagged as degraded.

During healthy operation: all factors are near their normal levels, deviations are small, the metric tracks its daily profile with gentle noise.

During degradation: one or more factors deviate significantly, pulling the metric away from its profile. The factor with the largest `|weight × deviation|` is the primary contributor.

### Factor Status (Always Visible)

Each factor always reports:
- **value**: current level (e.g., DHCP success rate: 0.94)
- **status**: green (normal) / yellow (degraded) / red (critical) — thresholds derived from bootstrap distributions
- **contribution**: how much this factor is pulling the metric away from its expected value, as a signed offset in metric units

During steady state, all factors show green with small contributions — the admin sees "everything nominal" at a glance. During degradation, one or two factors go yellow/red and dominate the contribution breakdown.

### Perturbation Retargeting

Currently, perturbations affect shared drivers:
```python
# Current
"device_crash": { "affected_metrics": { "infra_health": -0.40 } }
```

New: perturbations target factors directly:
```python
# Proposed
"dhcp_server_overload": {
    "affected_factors": {
        "successful_connects.dhcp": -0.35,
        "time_to_connect.dhcp_latency": -0.30,
    },
    "duration_seconds": 180,
    "decay_type": "exponential",
}

"device_crash": {
    "affected_factors": {
        "ap_health.uptime": -0.50,
        "ap_health.cpu": -0.20,
        "capacity.client_density": -0.10,
    },
    "duration_seconds": 120,
    "decay_type": "exponential",
}
```

This creates a clean causal chain: an event pushes specific factors out of range, which degrades the metrics that depend on those factors. Because factors are shared OU processes, a single perturbation (e.g., DHCP overload) automatically and causally degrades all metrics that depend on that factor. The attribution is automatic — you don't compute it after the fact, it falls out of the architecture.

### Environmental Conditions vs. Factors

There are two distinct categories in the simulation:

**Environmental conditions** are exogenous — they come from outside the WiFi system. The primary one is **`client_load`**: a model of diurnal human activity (people are awake during the day, asleep at night). It has a strong daily cycle and affects everything broadly. It is not something that "breaks" — it's a load condition.

**Factors** are endogenous — they represent the state of infrastructure sub-components (DHCP, DNS, association, etc.) that can degrade or fail. They are the things you diagnose and fix.

The existing `rf_quality` and `infra_health` drivers are retired — they were vague statistical proxies for what factors now model explicitly. Factor sharing across metrics (e.g., a single DHCP OU process affecting both successful_connects and time_to_connect) provides domain-correct cross-metric coupling, replacing the statistical correlation that shared drivers provided.

`client_load` survives as the sole environmental condition. It modulates factor behavior (more clients → more DHCP requests → more chances for DHCP to degrade) and feeds the daily profile backbone.

### Event Templates (Revised)

| Event | Factors Affected | Story |
|-------|-----------------|-------|
| `dhcp_server_overload` | successful_connects.dhcp, time_to_connect.dhcp_latency | DHCP server slow → connections fail/slow |
| `radius_timeout` | successful_connects.authorization, time_to_connect.auth_latency | Auth server timeout → auth failures |
| `dns_resolution_failure` | successful_connects.dns, time_to_connect.dns_latency | DNS outage → connection completion fails |
| `interference_event` | capacity.cochannel_interference, throughput.retry_rate, coverage.signal_strength | External RF interference → multiple metrics degrade |
| `device_crash` | ap_health.uptime, ap_health.cpu, capacity.client_density | AP crashes → health drops, clients redistribute |
| `firmware_update` | ap_health.uptime, ap_health.cpu | Planned maintenance → brief health dip |
| `channel_change` | throughput.channel_width, roaming.rssi_tuning | Radio reconfiguration → brief throughput/roaming disruption |
| `high_density_event` | capacity.client_density, throughput.airtime_utilization | Conference/lecture lets out → density spike |
| `rogue_ap` | coverage.cell_overlap, throughput.retry_rate | Rogue AP causes interference |
| `heat_event` | ap_health.temperature, ap_health.cpu | Environmental → thermal throttling |

## Data Model Changes

### Observation Model

Extend `MetricObservation` to include factor breakdown:

```python
class FactorStatus(BaseModel):
    name: str                    # e.g., "dhcp"
    value: float                 # current factor value (0-1)
    status: str                  # "green" | "yellow" | "red"
    contribution: float          # offset in metric units (signed)
    weight: float                # factor weight in metric formula

class MetricObservation(BaseModel):
    timestamp: int
    metric: str
    value: float
    entity: Optional[str] = None
    factors: Optional[List[FactorStatus]] = None  # NEW
```

The `factors` field is optional for backward compatibility. Older consumers can ignore it; new UX can use it for decomposition views.

### API Endpoint

Add or extend the metrics API to expose factor data:

```
GET /api/metrics/{metric}/observations  → includes factors[] in each observation
GET /api/metrics/{metric}/factors       → current factor states for the metric
```

The WebSocket feed should also include factor data in real-time observations.

### Config Extension

Config defines factor OU parameters and weights. Thresholds are NOT in config — they are derived from bootstrap.

```json
{
  "factors": {
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
      "factors": {
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
      "factors": {
        "association": { "weight": 0.20 },
        "authorization": { "weight": 0.25 },
        "dhcp": { "weight": 0.40 },
        "dns": { "weight": 0.15 }
      }
    }
  }
}
```

Note: factors are defined once at the top level (shared pool), and metrics reference them by name with weights. The same `dhcp` factor drives both `successful_connects` and `time_to_connect`. Thresholds (green/yellow/red) are computed during bootstrap from observed factor distributions and stored in `baselines.json` alongside metric baselines.

## Implementation Phases

### Phase 1: Factor Simulation Engine

**Goal**: Factors exist and are simulated as the stochastic primitive, metrics derive from them. Legacy abstract drivers removed (except `client_load`).

1. Define shared factor pool: identify factors referenced by multiple metrics (e.g., DHCP, interference) and create a single OU process for each unique factor
2. Define `FACTOR_DEFINITIONS` config with all factor OU params and descriptions
3. Define `METRIC_FACTORS` mapping: which factors each metric depends on, with weights
4. Add per-factor OU processes to `RealisticGenerator` (shared pool, not per-metric)
5. Rewrite `_derive_metric()`: `value = daily_profile(hour) + Σ(factor_weight × factor_deviation × metric_range)`
6. Remove abstract driver infrastructure: `DRIVER_DEFAULTS` (rf_quality, infra_health only), `METRIC_SENSITIVITIES`, `_update_drivers()`, `_driver_mean()`, associated OU state. **Keep `client_load`** as an environmental condition with its daily cycle.
7. Remove `METRIC_OU_NOISE` (replaced by factor OU processes)
8. Extend bootstrap to track factor values alongside metric values; compute per-factor hourly distributions
9. Store factor baselines in `baselines.json`; derive factor thresholds (green/yellow/red) from bootstrap percentiles
10. Validate: bootstrap still produces sensible baselines, daily profiles preserved, factor thresholds align with observed metric behavior

**Key constraint**: Factors are the simulation primitive — they are the source of stochastic variation, and metric values are derived consequences. The bootstrap captures the joint truth of factors and metrics together, ensuring thresholds are consistent with what the simulation actually produces.

### Phase 2: Perturbation Retargeting

**Goal**: Events affect factors, not shared drivers.

1. Redefine `PERTURBATION_TEMPLATES` to target factor names directly (e.g., `"dhcp": -0.35`)
2. Update `Perturbation` dataclass: `affected_factors: Dict[str, float]` replaces `affected_metrics`
3. Update `PerturbationManager.total_effect()` to resolve factor names from the shared pool
4. Apply perturbation effects to factor OU processes (push factor away from normal)
5. Rewrite event templates for the new factor vocabulary (dhcp_server_overload, radius_timeout, etc.)
6. Update load pattern templates similarly
7. Validate: events create visible factor degradation that cascades to all dependent metrics

### Phase 3: API Exposure

**Goal**: Factor data available to consumers.

1. Add `FactorStatus` model to `models.py`
2. Extend `MetricObservation` with optional `factors` field
3. Update `generate_observation()` to compute and include factor breakdown per metric
4. Extend HTTP API endpoint to return factor data
5. Include factor data in WebSocket real-time feed
6. Validate: API consumers receive factor breakdown with every observation

### Phase 4: Factor Baseline API

**Goal**: Expose factor baselines to consumers.

1. Add API endpoints for factor baseline distributions (per-factor hourly percentiles)
2. Expose factor baselines via HTTP API alongside metric baselines
3. Include factor baseline data in relevant WebSocket messages

Note: Factor baselines are *computed* in Phase 1 (as part of the bootstrap). This phase is about *exposing* them through the API. It can be done alongside or after Phase 3.

## Design Decisions (Resolved)

1. **Factor sharing across metrics**: Factors that represent the same infrastructure (e.g., DHCP) are **shared OU processes** referenced by multiple metrics. A single DHCP state drives both successful_connects and time_to_connect. These are facts about the real world — they affect all metrics to which they are relevant. A perturbation to the DHCP factor simultaneously and causally degrades all dependent metrics.

2. **Daily profiles stay at metric level**: The existing hand-crafted per-metric daily profiles are preserved as the deterministic backbone. Factors provide only the stochastic/perturbation layer on top. In theory, if real data became available for a metric's daily shape, we'd swap that in — the factor math stays the same. The formula becomes: `value = daily_profile(hour) + Σ(factor_weight × factor_deviation × metric_range)`.

3. **Environmental conditions vs. factors**: `client_load` is kept as a separate environmental condition — it models diurnal human activity ("people are diurnal") and is not something that breaks or gets diagnosed. `rf_quality` and `infra_health` are removed — they were abstract statistical proxies for what factors now model with domain-correct causality. Factor sharing across metrics provides the cross-metric coupling that shared drivers previously provided.

4. **Factor thresholds from bootstrap, not config**: The bootstrap creates the simulated truth — 30 days of history defining what "normal" is. If factors drive metric values, then factor values observed during bootstrap *are* the ground truth for normal factor behavior. Hardcoding factor ranges separately risks inconsistency: config could say "DHCP at 0.92 is yellow" while the bootstrap routinely produces DHCP at 0.90 as healthy. Factors are simulated during bootstrap, and thresholds are derived from observed percentiles — ensuring consistency between factor health and metric health.

## Scope Estimate

| Phase | Effort | Files Modified |
|-------|--------|---------------|
| Phase 1: Factor engine + bootstrap integration | Large | realistic_generator.py, bootstrap.py, config_enterprise.json (+ other configs) |
| Phase 2: Perturbation retargeting | Medium | perturbations.py, realistic_generator.py, event_generator.py |
| Phase 3: API exposure | Small-medium | models.py, http_api.py, websocket_server.py |
| Phase 4: Factor baseline API | Small | http_api.py, websocket_server.py |

Total: ~3-4 working sessions. Phase 1 is the largest (factor simulation, bootstrap integration, driver cleanup). Phases 3-4 could be combined.
