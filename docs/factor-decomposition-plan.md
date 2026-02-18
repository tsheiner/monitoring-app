# Factor Decomposition Plan

## Goal

Add domain-specific sub-component factors to each metric so that the simulator produces not just a metric value but a breakdown of *why* the metric is at that value. When a metric degrades, the factor breakdown reveals which sub-component is responsible — enabling root-cause analysis UX like the Meraki Assurance "failure contributors" view.

Each factor is always instrumented with its own value and health status (green/yellow/red), visible during both healthy and degraded states.

## Inspiration

Meraki Assurance Overview shows metrics like "Successful Connects: 80%" with a breakdown:
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

Each metric is defined as a function of 2-4 domain-specific factors. Each factor:
- Has its own OU process (value fluctuates naturally)
- Has a normal range and thresholds (green/yellow/red)
- Can be targeted by perturbations directly
- Contributes to the parent metric via a defined weight

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
- `normal_range`: [low, high] defining green status
- `degraded_threshold`: below this → yellow
- `critical_threshold`: below this → red

The metric value is computed as:

```
metric_value = daily_profile(hour) + Σ(factor_weight × factor_deviation × metric_range)
```

Where `factor_deviation = factor_value - factor_normal_level`.

During healthy operation: all factors are near their normal levels, deviations are small, the metric tracks its daily profile with gentle noise.

During degradation: one or more factors deviate significantly, pulling the metric away from its profile. The factor with the largest `|weight × deviation|` is the primary contributor.

### Factor Status (Always Visible)

Each factor always reports:
- **value**: current level (e.g., DHCP success rate: 0.94)
- **status**: green (normal) / yellow (degraded) / red (critical)
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

This creates a clean causal chain: an event pushes specific factors out of range, which degrades the metrics that depend on those factors. The attribution is automatic — you don't compute it after the fact, it falls out of the architecture.

### Shared Drivers

The three existing shared drivers (client_load, rf_quality, infra_health) can be **retired or reduced to background correlation**. Their current role was to provide cross-metric coupling, but factors provide a better mechanism: a DHCP outage naturally affects both successful_connects and time_to_connect because both have a DHCP factor. The coupling is domain-correct rather than statistical.

Option: keep shared drivers as very weak ambient correlation (even weaker than today's 20-30%), or remove them entirely and let factor overlap handle cross-metric effects.

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

Add factor definitions to `config_enterprise.json`:

```json
{
  "metrics": {
    "successful_connects": {
      "baseline": 98.2,
      "min": 94,
      "max": 99.8,
      "factors": {
        "association": {
          "weight": 0.20,
          "normal_level": 0.98,
          "degraded_threshold": 0.93,
          "critical_threshold": 0.85,
          "ou_theta": 0.0003,
          "ou_sigma": 0.0008,
          "description": "802.11 association success rate"
        },
        "authorization": {
          "weight": 0.25,
          "normal_level": 0.97,
          "degraded_threshold": 0.90,
          "critical_threshold": 0.80,
          "ou_theta": 0.0004,
          "ou_sigma": 0.0010,
          "description": "RADIUS/802.1X auth success rate"
        },
        "dhcp": {
          "weight": 0.40,
          "normal_level": 0.99,
          "degraded_threshold": 0.92,
          "critical_threshold": 0.80,
          "ou_theta": 0.0003,
          "ou_sigma": 0.0006,
          "description": "DHCP lease acquisition success rate"
        },
        "dns": {
          "weight": 0.15,
          "normal_level": 0.995,
          "degraded_threshold": 0.95,
          "critical_threshold": 0.85,
          "ou_theta": 0.0002,
          "ou_sigma": 0.0004,
          "description": "DNS resolution success rate"
        }
      }
    }
  }
}
```

## Implementation Phases

### Phase 1: Factor Simulation Engine

**Goal**: Factors exist and are simulated, but not yet exposed via API.

1. Define `METRIC_FACTORS` config structure with all factor definitions for all 7 metrics
2. Add per-factor OU processes to `RealisticGenerator` (similar to existing `_metric_noise_state`)
3. Rewrite `_derive_metric()` to compute metric value from factor states instead of directly from shared drivers
4. Each factor gets: OU process, thresholds, weight, current value
5. Validate: bootstrap still produces sensible baselines, daily profiles preserved

**Key constraint**: The new formula must produce the same *character* of output — distinct daily profiles, realistic ranges, Gaussian noise properties. Factors are a decomposition of the existing behavior, not a replacement.

### Phase 2: Perturbation Retargeting

**Goal**: Events affect factors, not shared drivers.

1. Redefine `PERTURBATION_TEMPLATES` to target `metric.factor` paths
2. Update `Perturbation` dataclass: `affected_factors: Dict[str, float]` replaces `affected_metrics`
3. Update `PerturbationManager.total_effect()` to resolve factor paths
4. Apply perturbation effects to factor OU processes (push factor away from normal)
5. Rewrite event templates for the new factor vocabulary (dhcp_server_overload, radius_timeout, etc.)
6. Validate: events create visible factor degradation that cascades to metrics

### Phase 3: API Exposure

**Goal**: Factor data available to consumers.

1. Add `FactorStatus` model to `models.py`
2. Extend `MetricObservation` with optional `factors` field
3. Update `generate_observation()` to compute and include factor breakdown
4. Extend HTTP API endpoint to return factor data
5. Include factor data in WebSocket real-time feed
6. Validate: API consumers receive factor breakdown with every observation

### Phase 4: Baseline Integration

**Goal**: Factor baselines support anomaly detection on individual factors.

1. Extend bootstrap to compute per-factor baselines (hourly distributions per factor)
2. Factor status thresholds can be computed from baseline percentiles
3. Store factor baselines alongside metric baselines in `baselines.json`
4. Expose factor baselines via API

## Open Questions

1. **Factor overlap across metrics**: DHCP affects both successful_connects and time_to_connect. Should these share the same underlying factor OU process (true shared state) or have separate OU processes that happen to be perturbed by the same events? Shared state is more realistic; separate is simpler.

2. **Granularity of daily profiles**: Currently each metric has a hand-crafted daily profile. With factors, should the daily profile be decomposed into per-factor profiles, or should the metric-level profile remain as the deterministic backbone with factors providing only the stochastic/perturbation layer?

3. **Backward compatibility**: Should the existing shared drivers (client_load, rf_quality, infra_health) be kept as a thin ambient correlation layer, or fully replaced by factor overlap? Keeping them adds complexity but preserves the current stochastic character.

4. **Bootstrap performance**: Adding ~25 factor OU processes (7 metrics × ~3.5 factors each) to the bootstrap simulation will increase computation. Need to verify the 60s bootstrap time budget is still met.

## Scope Estimate

| Phase | Effort | Files Modified |
|-------|--------|---------------|
| Phase 1: Factor engine | Medium-large | realistic_generator.py, config_enterprise.json (+ other configs) |
| Phase 2: Perturbation retargeting | Medium | perturbations.py, realistic_generator.py, event_generator.py |
| Phase 3: API exposure | Small-medium | models.py, http_api.py, websocket_server.py |
| Phase 4: Baseline integration | Medium | bootstrap.py, metrics_store.py, http_api.py |

Total: ~3-4 working sessions, with Phase 1 being the most architecturally significant.
