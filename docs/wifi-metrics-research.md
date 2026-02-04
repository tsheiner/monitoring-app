# WiFi Network Monitoring Metrics - Research Findings

**Research Date**: February 4, 2026  
**Purpose**: Establish realistic WiFi network metrics behaviors for data generation

---

## 1. Key WiFi Performance Indicators

### 1.1 Time to Connect (Connection Latency)

**Definition**: Time for a client device to complete 802.11 association and authentication

**Realistic Values**:
- **Optimal**: 5-25ms (modern WiFi 6/6E with fast roaming)
- **Normal**: 25-75ms (standard enterprise WiFi 5/6)
- **Acceptable**: 75-150ms (high-density environments)
- **Degraded**: 150-500ms (user-perceivable delays)
- **Critical**: >500ms (unacceptable user experience)

**Typical Behavior**:
- **Baseline noise**: ±3-8ms during stable periods
- **Business hours**: +10-30ms due to increased authentication server load
- **Peak load**: Can spike to 200-500ms when AP handles 50+ simultaneous auth requests
- **Fast roaming (802.11r)**: 10-30ms typical
- **Legacy roaming**: 100-300ms typical

**Time Series Characteristics**:
- Relatively smooth during off-hours (low variance)
- Jagged during business hours with frequent micro-spikes
- Correlation: Increases when capacity >70%

---

### 1.2 Throughput (Data Transfer Rate)

**Definition**: Actual achieved data rate (not PHY rate)

**Realistic Values by WiFi Generation**:
- **WiFi 5 (802.11ac)**:
  - Good signal: 200-600 Mbps
  - Fair signal: 100-250 Mbps
  - Poor signal: 20-100 Mbps
  
- **WiFi 6 (802.11ax)**:
  - Good signal: 400-1200 Mbps
  - Fair signal: 200-500 Mbps
  - Poor signal: 50-200 Mbps
  
- **WiFi 6E (6GHz)**:
  - Good signal: 600-2000 Mbps
  - Fair signal: 300-800 Mbps
  - Poor signal: 100-300 Mbps

**Typical Behavior**:
- **Baseline noise**: ±15-25% of mean value
- **Daily pattern**: Lower at night (fewer users), higher during business hours
- **Variance**: Much higher than wired networks (±20-40% normal)
- **Congestion impact**: Can drop to 10-30% of optimal during high density
- **Distance decay**: ~50% throughput loss every 10-15 meters from AP

**Time Series Characteristics**:
- Moderately jagged (noisier than wired networks)
- Inverse correlation with client count and capacity
- Sudden drops indicate interference or congestion
- Should show clear diurnal patterns

---

### 1.3 Coverage/RSSI (Signal Strength)

**Definition**: Received Signal Strength Indicator in dBm

**Realistic Values**:
- **Excellent**: -30 to -50 dBm (very close to AP)
- **Good**: -50 to -67 dBm (normal operating range)
- **Fair**: -67 to -75 dBm (marginal, reduced throughput)
- **Poor**: -75 to -85 dBm (connection unstable)
- **Unusable**: < -85 dBm (frequent disconnects)

**Typical Behavior**:
- **Static clients**: ±1-3 dBm variance (very stable)
- **Mobile clients**: ±5-12 dBm variance (more dynamic)
- **Interference impact**: -3 to -8 dBm degradation during congestion
- **Environmental factors**: ±2-5 dBm due to humidity, people movement
- **Time of day**: Minimal variation (mostly structural)

**Time Series Characteristics**:
- Smooth for static deployments (low noise)
- Shows gradual drift as clients roam
- Sudden drops indicate physical obstruction or interference
- Least seasonal of all metrics (structure-dependent)

**Distribution Patterns**:
- Typically shows bimodal distribution:
  - Near-field clients: -40 to -55 dBm
  - Far-field clients: -65 to -75 dBm
- Coverage holes show as consistent < -80 dBm zones

---

### 1.4 Network Capacity/Utilization

**Definition**: Airtime utilization percentage (0-100%)

**Realistic Values**:
- **Low**: 5-20% (off-hours, few clients)
- **Normal**: 20-45% (typical business hours)
- **Busy**: 45-65% (high usage periods)
- **Congested**: 65-85% (performance degradation begins)
- **Saturated**: >85% (severe degradation, packet loss)

**Typical Behavior**:
- **Baseline noise**: ±5-10% during stable periods
- **Sudden jumps**: Large file transfers, video conferences, backups
- **Peak hours**: 9-11am, 1-3pm typically highest
- **Weekend factor**: 30-50% of weekday levels
- **Per-client consumption**: 
  - Idle: 1-3%
  - Web browsing: 3-8%
  - Video streaming: 8-15%
  - File transfer: 15-30%

**Time Series Characteristics**:
- Moderately jagged with sharp spikes
- Strong daily seasonality (business hours cycle)
- Weekly seasonality (weekday vs weekend)
- Should correlate inversely with throughput when >70%

---

### 1.5 Roaming Performance

**Definition**: Handoff latency between access points

**Realistic Values**:
- **Fast roaming (802.11r/k/v)**: 10-50ms
- **Standard roaming**: 50-200ms
- **Legacy roaming**: 200-800ms
- **Failed roaming**: >1000ms (client disconnects)

**Typical Behavior**:
- **Baseline**: 30-100ms for 802.11r networks
- **Variance**: ±20-50ms depending on client device capability
- **Peak impact**: +50-150ms when target AP is heavily loaded
- **Success rate**: 95-99% for well-designed networks
- **Sticky client problem**: Delays of 500-2000ms when client refuses to roam

**Time Series Characteristics**:
- Sparse data (only occurs during roaming events)
- More events during business hours (mobile users)
- Spikes correlate with capacity saturation on target AP
- Should aggregate: median, p95, p99 over time windows

**Typical Roaming Patterns**:
- Office environment: 2-10 roams per client per hour
- Warehouse: 10-30 roams per client per hour
- Healthcare: 15-40 roams per client per hour

---

### 1.6 Connection Success Rate

**Definition**: Percentage of successful authentications

**Realistic Values**:
- **Excellent**: 98-100% (well-tuned network)
- **Good**: 95-98% (acceptable operation)
- **Fair**: 90-95% (user impact noticeable)
- **Poor**: 85-90% (significant complaints)
- **Critical**: <85% (major issues)

**Typical Behavior**:
- **Baseline**: 97-99.5% for stable networks
- **Noise**: ±0.5-1.5% random variation
- **Authentication server issues**: Drops to 80-95%
- **AP overload**: Drops to 85-95%
- **Weak coverage**: Drops to 70-90% in dead zones

**Time Series Characteristics**:
- Very smooth during normal operation (high percentages)
- Sharp drops during failures
- Should be inverted on chart (lower is worse)
- Correlates with capacity and RSSI

**Common Failure Causes**:
- RADIUS timeout: -2 to -5% success rate
- Weak signal (<-80 dBm): -5 to -15% success rate
- AP CPU saturation: -3 to -10% success rate
- Channel congestion: -2 to -8% success rate

---

### 1.7 Access Point Health Score

**Definition**: Composite health metric (0-100)

**Components** (typical weighting):
- CPU utilization: 25%
- Memory usage: 20%
- Client count: 20%
- Channel utilization: 15%
- Error rate: 10%
- Uptime/stability: 10%

**Realistic Values**:
- **Excellent**: 90-100 (optimal operation)
- **Good**: 80-90 (normal variance)
- **Fair**: 70-80 (minor issues)
- **Degraded**: 50-70 (performance impact)
- **Critical**: <50 (failing hardware or severe issues)

**Typical Behavior**:
- **Baseline**: 85-95 for healthy APs
- **Noise**: ±3-7 points during normal operation
- **Daily cycle**: -5 to -10 points during peak hours (CPU/client load)
- **Firmware update**: Temporary drop to 60-75 during reboot
- **Hardware failure**: Sudden drop to <40

**Time Series Characteristics**:
- Relatively smooth during normal operation
- Gradual decline indicates degradation
- Sudden drops indicate failures or reboots
- Should show diurnal patterns (load-dependent)

---

## 2. Realistic Time Series Patterns

### 2.1 Noise Levels vs Signal

**General Rule**: Wireless metrics are 3-5x noisier than wired networks

| Metric | Smoothness | Typical Coefficient of Variation |
|--------|-----------|----------------------------------|
| RSSI/Coverage | Very smooth | 5-10% |
| AP Health | Smooth | 5-12% |
| Success Rate | Smooth | 1-3% |
| Time to Connect | Moderate | 15-25% |
| Throughput | Jagged | 25-40% |
| Capacity | Jagged | 30-50% |
| Roaming | Very jagged | 40-80% |

**Rendering Guidance**:
- **Smooth metrics** (RSSI, AP Health): Use fewer data points, can interpolate
- **Jagged metrics** (Throughput, Capacity): Need dense data points, minimal smoothing
- **Event-driven metrics** (Roaming): Aggregate to time buckets for visualization

---

### 2.2 Periodicities

#### Daily Patterns (Dominant)

**Business Environment (Office, Campus)**:
- **6am-8am**: Ramp up (10-30% of peak)
- **8am-9am**: Morning surge (+40-60% of peak)
- **9am-12pm**: Peak hours (80-100% of peak)
- **12pm-1pm**: Lunch dip (-20-30% from peak)
- **1pm-4pm**: Afternoon peak (80-100% of peak)
- **4pm-6pm**: Decline (-30-50% from peak)
- **6pm-11pm**: Evening low (10-30% of peak)
- **11pm-6am**: Overnight minimum (5-15% of peak)

**24/7 Environment (Healthcare, Hospitality)**:
- Flatter profile (40-80% utilization always)
- Shift changes cause mini-spikes
- Night shift: 50-70% of day shift levels

**Retail/Public**:
- Peak: 11am-2pm, 5pm-7pm
- Weekend patterns differ significantly

#### Weekly Patterns

**Office Environment**:
- Monday: 90-95% of midweek levels (slow start)
- Tuesday-Thursday: 100% (peak days)
- Friday: 80-90% of midweek (early departures)
- Saturday: 10-25% of weekday
- Sunday: 5-15% of weekday

**Healthcare/Hospitality**:
- Weekends only 10-20% lower than weekdays
- More consistent 7-day pattern

#### Seasonal Patterns (Long-term)

- Summer: -10 to -20% (vacations)
- Holidays: -30 to -60% (closures)
- Back to school: +15 to +25% (academic)
- Growth trend: +5-15% year-over-year

---

### 2.3 Metric Correlations

**Strong Positive Correlations**:
- Capacity ↔ Client Count (r=0.8-0.9)
- Time to Connect ↔ Capacity when >70% (r=0.6-0.8)
- AP Health ↔ Success Rate (r=0.7-0.8)

**Strong Negative Correlations**:
- Throughput ↔ Capacity when >60% (r=-0.6-0.8)
- Success Rate ↔ Time to Connect (r=-0.5-0.7)
- RSSI ↔ Distance from AP (r=-0.9)

**Weak/No Correlations**:
- RSSI ↔ Time of Day (structural, not temporal)
- Roaming ↔ Throughput (independent factors)

**Cascading Effects**:
1. **Capacity spike** → Time to Connect increases (+20-100ms)
2. **Interference event** → Coverage drops (-5 to -10 dBm) → Throughput drops (-30-60%) → Capacity increases (+10-20%)
3. **AP overload** → Success Rate drops (-5-15%) → Time to Connect spikes (+50-200ms) → Health Score drops (-15-30 points)

---

### 2.4 Distribution Variance Over Time

**Stable Periods** (off-hours, low usage):
- Narrow distributions (p95-p5 < 30% of mean)
- Low standard deviation
- Symmetric/normal distributions

**Busy Periods** (business hours, high usage):
- Wide distributions (p95-p5 = 50-100% of mean)
- High standard deviation  
- Right-skewed distributions (occasional high values)

**Example: Time to Connect**:
- **2am (off-hours)**: Mean=25ms, σ=5ms, p5=18ms, p95=35ms
- **11am (peak hours)**: Mean=65ms, σ=25ms, p5=30ms, p95=150ms

**Example: Throughput**:
- **Off-hours**: Mean=450 Mbps, σ=60 Mbps, distribution narrow
- **Peak hours**: Mean=280 Mbps, σ=120 Mbps, distribution wide with long tail

---

## 3. Realistic Behaviors

### 3.1 Business Hours vs Off-Hours

#### Off-Hours (6pm - 6am)

**Characteristics**:
- 5-25% of peak load
- Minimal user activity
- Background services (backups, updates)
- Stable, predictable metrics
- Lower variance/noise

**Typical Values**:
- Capacity: 5-15%
- Time to Connect: 20-35ms
- Throughput: 400-700 Mbps (per client)
- Success Rate: 99-100%
- AP Health: 90-98

#### Business Hours (8am - 6pm)

**Characteristics**:
- 80-100% of peak load
- High user density
- Dynamic, variable metrics
- Higher variance/noise
- Frequent roaming events

**Typical Values**:
- Capacity: 40-75%
- Time to Connect: 50-120ms
- Throughput: 150-400 Mbps (per client, contention)
- Success Rate: 95-99%
- AP Health: 80-90

#### Transition Periods

**Morning Ramp (7am-9am)**:
- Rapid increase in all utilization metrics
- Connection storms (100+ devices in 2 hours)
- Authentication servers under load
- Time to Connect spikes possible

**Evening Decline (5pm-7pm)**:
- Gradual decrease in utilization
- Fewer but longer-duration sessions
- Less predictable (some users work late)

---

### 3.2 Variance and Noise by Metric Type

#### Low-Variance Metrics (<15% CV)

**RSSI/Coverage**:
- Structurally determined
- Variance: ±2-5 dBm typical
- Smoothing: Can use 30-60s moving average

**AP Health Score**:
- Composite metric (averaged components)
- Variance: ±5-8 points typical
- Smoothing: Can use 1-5 minute moving average

**Success Rate**:
- High percentage (95-100%)
- Variance: ±0.5-2% typical
- Calculated over windows (not instantaneous)

#### Medium-Variance Metrics (15-30% CV)

**Time to Connect**:
- Authentication variability
- Variance: ±10-30ms typical
- Display: Raw values with distribution ribbon

**AP Health**:
- Load-dependent
- Variance: ±5-15 points typical
- Display: Smoothed line preferred

#### High-Variance Metrics (>30% CV)

**Throughput**:
- Highly dynamic
- Variance: ±50-150 Mbps typical
- Display: Raw values, wider distribution ribbon

**Capacity**:
- Bursty behavior
- Variance: ±15-25% typical
- Display: Raw values, show spikes

**Roaming**:
- Event-driven
- Variance: ±30-100ms typical
- Display: Aggregated (p50, p95) over time buckets

---

### 3.3 Cascading Effects

#### Scenario 1: Channel Interference

**Trigger**: Neighboring AP on same channel, microwave oven, Bluetooth device

**Timeline**:
- T+0s: Interference begins
- T+2s: Coverage/RSSI drops -5 to -10 dBm
- T+5s: Throughput drops 30-60% as clients retry transmissions
- T+10s: Capacity increases 15-30% (same traffic, more airtime needed)
- T+15s: Time to Connect increases +20-50ms (more retries)
- T+30s: Some clients may roam to different AP

**Duration**: Seconds to hours (depending on interference source)

**Recovery**: Immediate when interference stops, or gradual as clients roam away

---

#### Scenario 2: AP Overload

**Trigger**: >50 clients on single AP, capacity >75%

**Timeline**:
- T+0s: Client count exceeds threshold
- T+5s: CPU utilization spikes 60-90%
- T+10s: AP Health drops 15-30 points
- T+15s: Time to Connect increases +50-150ms (auth queue backlog)
- T+20s: Success Rate drops 3-8% (some timeouts)
- T+30s: Throughput degrades 20-40% (contention)
- T+60s: Roaming may increase as clients seek better APs

**Duration**: Until load decreases or clients redistributed

**Recovery**: 1-5 minutes after load reduction

---

#### Scenario 3: AP Crash/Reboot

**Timeline**:
- T+0s: AP goes offline
- T+0s: AP Health → 0 (no data)
- T+0-10s: Connected clients disconnect (Success Rate → 0 for that AP)
- T+10-30s: Clients attempt reconnection, roam to nearby APs
- T+30-60s: Nearby APs see capacity spike +20-40%
- T+60s: AP comes back online (firmware reload)
- T+90s: AP Health recovers to 60-80 (booting)
- T+120s: Clients begin reconnecting
- T+300s: AP Health returns to 85-95 (normal)

**Recovery**: 5-10 minutes full recovery

---

### 3.4 Normal vs Degraded Performance

#### Normal Performance Indicators

**Metric Ranges**:
- Time to Connect: 20-80ms (p95 <150ms)
- Throughput: >50% of theoretical max
- Coverage: >-75 dBm for 95% of area
- Capacity: <70% typical, <85% peak
- Roaming: <200ms median, <500ms p95
- Success Rate: >97%
- AP Health: >85

**Characteristics**:
- Predictable daily patterns
- Narrow distribution ribbons
- Smooth metric transitions
- High success rates
- Few spikes or anomalies

---

#### Degraded Performance Indicators

**Metric Ranges**:
- Time to Connect: 150-500ms (p95 >500ms)
- Throughput: <30% of theoretical max
- Coverage: <-80 dBm for >10% of area
- Capacity: >80% sustained
- Roaming: >500ms median, >1000ms p95
- Success Rate: <95%
- AP Health: <70

**Characteristics**:
- Erratic, unpredictable patterns
- Wide distribution ribbons
- Frequent spikes and drops
- High variance
- Cascading failures

**Visual Cues** (for charts):
- Threshold breaches (red zones)
- Distribution ribbons widen significantly
- Multiple correlated metrics degrade simultaneously
- Event markers align with degradations

---

## 4. Recommended Data Generation Parameters

### 4.1 Updated Baseline Values

Based on research, recommended updates to current implementation:

```python
METRICS_CONFIG = {
    "time_to_connect": {
        "baseline": 45,           # ms (was 50, now more realistic)
        "amplitude": 25,          # daily swing (was 20, increased)
        "noise": 12,              # ±ms variance (was 10, slightly higher)
        "min": 10,                # fast roaming lower bound (was 15)
        "max": 250,               # spike ceiling (was 200, allow higher spikes)
        "business_factor": 1.6,   # 60% increase during business hours
        "weekend_factor": 0.4,    # 60% reduction on weekends
    },
    "throughput": {
        "baseline": 400,          # Mbps (was 300, WiFi 6 baseline)
        "amplitude": 180,         # daily swing (was 150, more variation)
        "noise": 80,              # ±Mbps variance (was 50, more realistic)
        "min": 50,                # degraded minimum
        "max": 1200,              # WiFi 6 ceiling (was 1000)
        "business_factor": 0.7,   # 30% reduction during contention
        "weekend_factor": 0.5,    # 50% reduction on weekends
    },
    "coverage": {
        "baseline": -62,          # dBm (was -60, slightly more realistic)
        "amplitude": 8,           # daily swing (was 10, RSSI more stable)
        "noise": 3,               # ±dBm variance (was 5, RSSI very stable)
        "min": -85,               # unusable threshold (was -90)
        "max": -35,               # very close to AP (was -30)
        "business_factor": 0.95,  # 5% degradation (people/interference)
        "weekend_factor": 1.0,    # no weekly effect (structural)
    },
    "capacity": {
        "baseline": 40,           # % (was 45, slightly lower baseline)
        "amplitude": 28,          # daily swing (was 25, more variation)
        "noise": 12,              # ±% variance (was 10, more spiky)
        "min": 3,                 # idle minimum (was 5)
        "max": 95,                # saturation ceiling
        "business_factor": 1.8,   # 80% increase during business hours
        "weekend_factor": 0.35,   # 65% reduction on weekends
    },
    "roaming": {
        "baseline": 85,           # ms (was 100, 802.11r lower)
        "amplitude": 55,          # daily swing (was 50, more variation)
        "noise": 35,              # ±ms variance (was 30, very spiky)
        "min": 10,                # fast roaming minimum
        "max": 600,               # failed roaming (was 500, allow higher)
        "business_factor": 1.4,   # 40% increase during load
        "weekend_factor": 0.6,    # 40% reduction on weekends
    },
    "successful_connects": {
        "baseline": 98.5,         # % (was 98, slightly higher for good network)
        "amplitude": 2.5,         # daily swing (was 3, tighter control)
        "noise": 0.8,             # ±% variance (was 1, very stable)
        "min": 88,                # critical threshold (was 85)
        "max": 100,               # perfect success
        "business_factor": 0.97,  # 3% reduction during load
        "weekend_factor": 1.02,   # 2% improvement (less load)
    },
    "ap_health": {
        "baseline": 88,           # score (was 90, slightly more realistic)
        "amplitude": 12,          # daily swing (was 10, more variation)
        "noise": 6,               # ±points variance (was 5, composite metric)
        "min": 45,                # critical failure (was 40)
        "max": 100,               # perfect health
        "business_factor": 0.92,  # 8% reduction during load
        "weekend_factor": 1.05,   # 5% improvement (less load)
    }
}
```

### 4.2 Noise Generation Strategy

**Current Implementation**: Simple Gaussian noise

**Recommended Enhancement**: Multi-component noise

```python
def _compute_noise(self, metric: str, hour_of_day: float) -> float:
    """
    Multi-component noise that's realistic:
    1. Base Gaussian noise (always present)
    2. Occasional spikes (Poisson process)
    3. Busier during business hours
    """
    config = self.METRICS_CONFIG[metric]
    
    # Base Gaussian noise
    base_noise = np.random.normal(0, config["noise"])
    
    # Business hours multiplier (more variance when busy)
    business_hours = 0.35 < hour_of_day < 0.75  # 8am-6pm
    if business_hours:
        base_noise *= 1.3  # 30% more noise during business hours
    
    # Occasional spikes (5% chance)
    if np.random.random() < 0.05:
        spike_direction = 1 if metric in ["time_to_connect", "capacity", "roaming"] else -1
        base_noise += spike_direction * config["noise"] * np.random.uniform(1, 3)
    
    return base_noise
```

### 4.3 Seasonality Patterns

**Current Implementation**: Simple sine wave with weekend factor

**Recommended Enhancement**: Multi-frequency composition

```python
def _compute_seasonality(self, timestamp: int) -> dict:
    """
    Multi-frequency seasonality:
    - Hourly: sub-daily variations (morning/afternoon peaks)
    - Daily: 24-hour cycle
    - Weekly: weekday vs weekend
    """
    hour_of_day = (timestamp % 86400) / 86400  # 0-1
    day_of_week = ((timestamp // 86400) % 7)   # 0-6
    
    # Daily cycle: peak at 11am (0.458) and 2pm (0.583)
    # Create double-peak for typical business hours
    daily = (
        0.4 * np.sin((hour_of_day - 0.208) * 2 * np.pi) +  # Morning peak
        0.6 * np.sin((hour_of_day - 0.333) * 2 * np.pi)    # Afternoon peak
    )
    
    # Weekly cycle: weekdays (0-4) vs weekends (5-6)
    weekly = 1.0 if day_of_week < 5 else 0.4  # 60% reduction on weekends
    
    # Morning surge (7-9am) and evening decline (5-7pm)
    if 0.29 < hour_of_day < 0.375:  # 7am-9am
        surge_factor = 1.3  # 30% boost
    elif 0.71 < hour_of_day < 0.79:  # 5pm-7pm
        surge_factor = 0.8  # 20% decline
    else:
        surge_factor = 1.0
    
    return {
        "daily": daily,
        "weekly": weekly,
        "surge": surge_factor
    }
```

---

## 5. Validation Checklist

Use this checklist to validate generated data appears realistic:

### Visual Inspection

- [ ] **Daily patterns visible**: Clear rise/fall with business hours
- [ ] **Weekly patterns visible**: Weekend usage noticeably lower
- [ ] **Noise appropriate**: Not too smooth (fake) or too spiky (unusable)
- [ ] **Correlations present**: Capacity up → Throughput down when congested
- [ ] **Distributions widen**: More variance during busy hours
- [ ] **No impossible values**: All values within realistic min/max bounds

### Statistical Tests

- [ ] **Coefficient of variation**: Matches research values (±20%)
- [ ] **Autocorrelation**: Present (not random walk)
- [ ] **Cross-correlation**: Capacity vs Throughput negative when >60%
- [ ] **Peak-to-trough ratio**: 3-10x for most metrics
- [ ] **Distribution shape**: Right-skewed during busy periods

### Domain Expert Review

- [ ] **Typical values**: Match reference ranges from vendors (Juniper, Cisco, Aruba)
- [ ] **Relationships make sense**: Degradations correlate logically
- [ ] **Event impacts**: Anomalies/events cause expected metric changes
- [ ] **Recovery times**: Realistic return to baseline (minutes, not seconds)

---

## 6. References and Sources

### Industry Standards
- **Juniper Mist AI**: WiFi Assurance metrics and benchmarks
- **Cisco Meraki**: Dashboard metrics and health scores
- **Aruba Networks**: AIOps and user experience metrics
- **802.11 Standards**: IEEE WiFi specifications (11r/k/v for roaming)

### Typical Enterprise Values
- **Office environment**: 50-200 clients per AP, 40-60% capacity typical
- **High-density**: 100-300 clients per AP, 60-80% capacity typical
- **WiFi 6 deployment**: 400-1200 Mbps achievable throughput
- **Fast roaming**: <50ms with 802.11r, 100-300ms without

### Monitoring Best Practices
- **Sampling interval**: 10-30s for most metrics
- **Aggregation**: 1-5 minute rollups for display
- **Retention**: 7 days high-resolution, 90 days aggregated
- **Alerting thresholds**: p95 values, not instantaneous

---

## Summary

WiFi metrics are inherently noisier and more variable than wired network metrics. Key characteristics for realistic data generation:

1. **Variance matters**: 25-40% coefficient of variation is normal for throughput/capacity
2. **Strong seasonality**: Daily patterns dominant, weekly patterns significant
3. **Correlations exist**: Metrics don't move independently
4. **Distribution dynamics**: Wider distributions during busy hours
5. **Cascading effects**: One degradation triggers others with realistic delays

The most important aspect is **variability** - WiFi is dynamic. Overly smooth data looks artificial. Aim for controlled chaos that matches the research ranges above.
