# Causal Architecture: Metrics Emerge from Classifiers

**Status**: Design Document  
**Date**: 2026-04-13  
**Purpose**: Define how metric values are derived from classifier state through a causal chain driven by external forces

---

## Problem Statement

The original architecture had metrics computed as:

```python
metric = daily_profile(hour) + polarity × Σ(weight × classifier_deviation)
```

This created a fundamental disconnect:
- **Daily profile** was an independent pattern (e.g., "time_to_connect = 37ms at 9am")
- **Classifiers** pushed/pulled against this baseline
- **Result**: Metric baselines and classifier baselines computed independently during bootstrap
- **Consequence**: Metric could be at p90 while all classifiers were at their p50 (misalignment)

**Core Issue**: There is no "natural" baseline for connection time independent of what the classifiers are doing. The daily rhythm should **emerge** from classifier behavior, not exist separately.

---

## New Architecture: Causal Chain

```
External Forces → Classifiers → Metrics
```

### 1. External Forces (Drivers of Network Behavior)

#### Primary Force: Client Load
**Definition**: Number of active users and devices on the network at any given time.

**Time-of-day pattern**: 
- Low overnight (0.15-0.25)
- Morning surge 8-9am (0.50 → 0.75)
- Business hours plateau (0.70-0.80)
- Evening decline 5-7pm (0.75 → 0.30)
- Weekend reduction (0.6× weekday levels)

**Direct impacts**:
- `client_density` ↑ (more clients per radio cell)
- `dhcp` ↓ (DHCP server queue pressure)
- `authorization` ↓ (RADIUS authentication queue pressure)
- `airtime_utilization` ↑ (more RF contention)
- `cpu` ↑ (APs processing more traffic)
- `memory` ↑ (larger connection tables)

#### Secondary Forces

**Scheduled Events**:
- Backups (2am): `cpu` ↓, `memory` ↓
- Firmware updates: `uptime` resets, temporary `cpu` spike
- Maintenance windows: targeted classifier impacts

**Environmental**:
- RF interference (time-varying): `cochannel_interference` ↓, `nonwifi_interference` ↓
- Temperature cycles: `temperature` ↓ during afternoon heat
- Physical obstructions: `cell_overlap` ↓ (static, but event-driven changes)

**Pure Physics** (no time variation):
- `coverage` (RSSI): RF propagation is constant
- `ap_density`: Geometric - doesn't change by hour
- `signal_strength`: Physics-based, very stable

#### Perturbation Events

External shocks that directly impact classifiers:
- Component failures: `dhcp_server_overload` → `dhcp` ↓
- RF problems: `interference_event` → `cochannel_interference` ↓, `retry_rate` ↓
- Hardware issues: `heat_event` → `temperature` ↓, `cpu` ↓
- Attacks: DDoS creates asymmetric classifier pattern (see examples below)

---

### 2. Classifiers: Mean-Reverting to Time-Varying Targets

Each classifier is an Ornstein-Uhlenbeck (OU) process that mean-reverts to a **target value** that varies based on external forces.

#### Load-Sensitive Classifiers

These respond directly to `client_load`:

| Classifier | Base Target | Load Response | Reasoning |
|------------|-------------|---------------|-----------|
| `dhcp` | 0.98 | `-0.15 × (load - 0.3)` | DHCP server queue pressure under load |
| `authorization` | 0.97 | `-0.20 × (load - 0.3)` | RADIUS authentication slower when busy |
| `client_density` | 0.90 | `-0.50 × load` | Direct measure of clients/cell (inverted) |
| `airtime_utilization` | 0.85 | `-0.30 × (load - 0.2)` | More contention with more traffic |
| `cpu` | 0.95 | `-0.20 × (load - 0.3)` | APs work harder processing more clients |
| `memory` | 0.93 | `-0.15 × (load - 0.3)` | Larger connection tables |

Example:
```python
# 9am morning rush: client_load = 0.75
dhcp_target = 0.98 - 0.15 × (0.75 - 0.3) = 0.98 - 0.068 = 0.912
authorization_target = 0.97 - 0.20 × (0.75 - 0.3) = 0.97 - 0.090 = 0.880

# 3am quiet: client_load = 0.15
dhcp_target = 0.98 - 0.15 × (0.15 - 0.3) = 0.98 + 0.023 = 1.0 (clamped)
authorization_target = 0.97 - 0.20 × (0.15 - 0.3) = 0.97 + 0.030 = 1.0 (clamped)
```

#### Load-Insensitive Classifiers

These have fixed targets or respond to other forces:

- `association`: 0.98 (stable, event-driven degradation only)
- `dns`: 0.96 (depends on DNS server health, not load)
- `coverage`: 0.92 (RF physics, very stable)
- `signal_strength`: 0.90 (physics-based)
- `ap_density`: 0.85 (geometric, static)
- `cell_overlap`: 0.80 (static unless APs added/removed)
- `low_rssi_clients`: 0.82 (load-correlated but different mechanism)
- `cochannel_interference`: 0.88 (RF environment)
- `nonwifi_interference`: 0.92 (environmental)
- `retry_rate`: 0.90 (RF quality + load)
- `cca_busy`: 0.85 (airtime availability)
- `channel_width`: 0.88 (configuration + interference)
- `handoff_latency`: 0.85 (roaming implementation quality)
- `rssi_tuning`: 0.90 (configuration quality)
- `80211rk_support`: 0.95 (feature support)
- `uptime`: 0.95 (event-driven: reboots, crashes)
- `temperature`: 0.90 (environmental + load)

#### OU Process Dynamics

```python
# Classifier evolution (discrete time step)
current_value_t+1 = current_value_t + theta × (target - current_value_t) × dt + sigma × sqrt(dt) × N(0,1)

# Where:
# - theta: mean-reversion speed (how quickly it returns to target)
# - sigma: volatility (how noisy the process is)
# - target: time-varying target based on external forces
# - dt: time step (30 seconds)
```

---

### 3. Metrics: Weighted Average of Classifiers

Metrics are computed **purely** from classifier values using a weighted average formula.

#### Formula

```python
# 1. Compute weighted health score (0.0 to 1.0)
weighted_health = Σ(weight_i × classifier_value_i)

# 2. Map to metric range based on polarity
if metric in LOWER_IS_BETTER:  # time_to_connect, capacity, roaming
    metric_value = metric_min + (1 - weighted_health) × (metric_max - metric_min)
else:  # throughput, coverage, successful_connects, ap_health
    metric_value = metric_min + weighted_health × (metric_max - metric_min)
```

**Key properties**:
- Metric has NO independent pattern - it emerges from classifiers
- When classifiers are at their p50, metric is at its p50
- Metric anomaly ⟺ classifier anomaly (alignment guaranteed)

#### Example: time_to_connect at 9am

**Classifiers** (morning rush, client_load = 0.75):
```python
association = 0.95 (weight 0.20)
authorization = 0.88 (weight 0.25)
dhcp = 0.91 (weight 0.40)
dns = 0.96 (weight 0.15)

weighted_health = 0.20×0.95 + 0.25×0.88 + 0.40×0.91 + 0.15×0.96
                = 0.190 + 0.220 + 0.364 + 0.144
                = 0.918
```

**Metric** (lower is better):
```python
time_to_connect = 15 + (1 - 0.918) × (200 - 15)
                = 15 + 0.082 × 185
                = 15 + 15.2
                = 30.2ms → 30ms
```

#### Example: time_to_connect at 3am

**Classifiers** (quiet period, client_load = 0.15):
```python
association = 0.97
authorization = 0.97
dhcp = 0.98
dns = 0.96

weighted_health = 0.20×0.97 + 0.25×0.97 + 0.40×0.98 + 0.15×0.96
                = 0.194 + 0.243 + 0.392 + 0.144
                = 0.973

time_to_connect = 15 + (1 - 0.973) × 185
                = 15 + 5.0
                = 20ms
```

**Bootstrap result** (30 days):
- At 9am: p50 = 30ms, p25 = 28ms, p75 = 32ms, p90 = 34ms
- At 3am: p50 = 20ms, p25 = 19ms, p75 = 21ms, p90 = 22ms
- Distribution ribbon correctly shows "normal for that hour"
- Classifiers and metrics are aligned

---

## Perturbation Scenarios

The new architecture enables realistic perturbation modeling through **classifier-specific impacts**.

### Scenario 1: DHCP Server Overload

```python
perturbation = {
    "dhcp": -0.60,  # drops from 0.91 → 0.31
}

# Impact:
# - time_to_connect: dhcp is 40% of formula → large spike
# - successful_connects: dhcp is 40% of formula → large drop
# - Other metrics: unaffected (dhcp not used)

# Causal story: DHCP server crashed, auth/RF/AP health all fine
```

### Scenario 2: Legitimate Load Spike

```python
# Client load surges from 0.60 → 0.95
# All load-sensitive classifiers respond together:
dhcp: 0.94 → 0.86
authorization: 0.91 → 0.78
client_density: 0.75 → 0.45
airtime_utilization: 0.80 → 0.60
cpu: 0.92 → 0.83

# Impact:
# - time_to_connect: moderate increase (multiple classifiers down)
# - capacity: large increase (client_density is primary driver)
# - throughput: decrease (airtime contention)
# - ap_health: slight decrease (cpu impact)

# Causal story: Network under heavy load but functioning as designed
```

### Scenario 3: DDoS Attack (Association Flood)

```python
perturbation = {
    "association": -0.70,  # overwhelmed with fake attempts
    "client_density": -0.40,  # appears as high density
    "airtime_utilization": -0.35,  # RF jammed with attempts
    "dhcp": -0.05,  # minimal spillover
    "authorization": 0.0,  # unaffected (no valid auth)
}

# client_load remains at 0.60 (not extreme)

# Impact:
# - time_to_connect: spike (association is 20% of formula)
# - successful_connects: large drop (association is 20%)
# - capacity: moderate impact (density down)
# - But: dhcp/auth relatively fine despite "high load"

# Causal story: Unusual pattern - association crushed, auth fine
# Detectable as attack vs. normal load
```

### Scenario 4: RF Interference Event

```python
perturbation = {
    "cochannel_interference": -0.40,
    "retry_rate": -0.30,
    "signal_strength": -0.20,
    "cca_busy": -0.25,
}

# Impact:
# - capacity: large increase (cochannel is 25%, cca is 20%)
# - throughput: decrease (retry_rate is 25%, cca is 15%)
# - coverage: slight decrease (signal_strength is 35%)
# - Connection metrics: unaffected

# Causal story: RF problem, not infrastructure or load
```

### Scenario 5: Heat Event (Afternoon)

```python
perturbation = {
    "temperature": -0.30,  # server room AC struggling
    "cpu": -0.15,  # thermal throttling
}

# Impact:
# - ap_health: decrease (temp is 15%, cpu is 30%)
# - Other metrics: minimal (slight cpu impact on processing)

# Causal story: Environmental issue, localized to AP hardware
```

---

## Bootstrap Process

With the new architecture:

1. **Generator runs for 30 days** with client_load following diurnal pattern
2. **Classifiers mean-revert** to time-varying targets based on load
3. **Metrics computed** from weighted classifier values
4. **Baselines captured** per hour:
   - Metric p10/p25/p75/p90 at each hour
   - Classifier p10/p25/p75/p90 at each hour
5. **Alignment guaranteed**: When classifiers are at their p50 for that hour, metric is at its p50

**No independent daily profile** - patterns emerge naturally from classifier dynamics.

---

## Migration Plan

### Phase 1: Remove Daily Profiles
- Delete `_metric_daily_profile()` method
- Remove `baseline` from metric formula

### Phase 2: Implement Load-Response Functions
```python
def get_classifier_target(classifier_name: str, client_load: float, timestamp: int) -> float:
    """Get time-varying target for a classifier based on external forces."""
    base_target = CLASSIFIER_DEFINITIONS[classifier_name]["initial_level"]
    
    # Load-sensitive classifiers
    if classifier_name == "dhcp":
        return base_target - 0.15 * max(0, client_load - 0.3)
    elif classifier_name == "authorization":
        return base_target - 0.20 * max(0, client_load - 0.3)
    elif classifier_name == "client_density":
        return base_target - 0.50 * client_load
    # ... etc
    
    # Load-insensitive: return fixed target
    return base_target
```

### Phase 3: Update Metric Derivation Formula
```python
def _derive_metric(self, metric: str, entity_key: str = "_global", timestamp: int = None) -> float:
    cfg = self.config[metric]
    metric_classifiers = METRIC_CLASSIFIERS.get(metric, {})
    
    # Compute weighted health from classifier values
    weighted_health = 0.0
    for classifier_name, weight in metric_classifiers.items():
        weighted_health += weight * self._classifier_state[classifier_name]
    
    # Map to metric range based on polarity
    metric_range = cfg["max"] - cfg["min"]
    if metric in LOWER_IS_BETTER:
        value = cfg["min"] + (1 - weighted_health) * metric_range
    else:
        value = cfg["min"] + weighted_health * metric_range
    
    return float(np.clip(value, cfg["min"], cfg["max"]))
```

### Phase 4: Update OU Process to Use Time-Varying Targets
```python
def _update_state(self, entity_key: str, timestamp: int) -> None:
    # ... update client_load based on time of day ...
    
    for classifier_name in self._classifier_state:
        target = get_classifier_target(classifier_name, client_load, timestamp)
        
        # OU mean-reversion to time-varying target
        current = self._classifier_state[classifier_name]
        theta = CLASSIFIER_DEFINITIONS[classifier_name]["theta"]
        sigma = CLASSIFIER_DEFINITIONS[classifier_name]["sigma"]
        
        # Apply perturbations
        perturbation_effect = self.perturbation_manager.get_effect(classifier_name, timestamp)
        effective_target = max(0.0, min(1.0, target + perturbation_effect))
        
        # OU step
        dt = 30  # seconds
        drift = theta * (effective_target - current) * dt
        diffusion = sigma * np.sqrt(dt) * np.random.randn()
        
        self._classifier_state[classifier_name] = np.clip(current + drift + diffusion, 0.0, 1.0)
```

### Phase 5: Re-run Bootstrap
- Generate new 30-day history with emergent patterns
- Compute new baselines (metrics and classifiers will align)
- Verify alignment: spot-check that metric p50 aligns with classifier p50

### Phase 6: Update Tests
- Update test expectations for new baseline values
- Verify perturbation scenarios produce expected patterns
- Confirm tooltip alignment (metric status matches classifier aggregate)

---

## Expected Outcomes

✅ **Alignment**: Distribution ribbon shows actual normal behavior  
✅ **Causality**: Metric anomalies explained by classifier anomalies  
✅ **Realism**: Perturbations have clear causal chains  
✅ **Debuggability**: Tooltip shows consistent status across metric and classifiers  
✅ **Flexibility**: Easy to model new perturbation types by targeting classifiers  

---

## References

- `backend/simulator/realistic_generator.py`: Classifier and metric generation
- `backend/simulator/bootstrap.py`: Baseline computation
- `frontend/src/chart/ChartView.ts`: Metric status computation (lines 592-615)
- `frontend/src/chart/generators/DistributionRibbonGenerator.ts`: Distribution visualization
