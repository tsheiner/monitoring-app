# Network Metrics Schema

The 7 core network health metrics based on industry standards (Juniper Mist).

## Metric Definitions

### 1. Time to Connect

**Description**: Latency for client device to complete association with access point

**Unit**: milliseconds (ms)

**Typical range**: 20-100ms

**What it measures**: Authentication + association handshake time

**Anomaly indicators**:

- \> 200ms: Slow, user-perceivable delay
- \> 500ms: Poor user experience
- Spikes often correlate with: AP overload, RADIUS delays, interference

---

### 2. Throughput

**Description**: Data transfer rate achieved by clients

**Unit**: Megabits per second (Mbps)

**Typical range**: 10-1000 Mbps (varies by WiFi generation)

**What it measures**: Actual data rate, not theoretical max

**Anomaly indicators**:

- \< 10% of expected: Severe degradation
- Sudden drops: Interference, congestion, AP issues
- Asymmetric (up vs down): Upstream bottleneck

---

### 3. Coverage

**Description**: Signal strength/quality at client location

**Unit**: dBm (decibel-milliwatts) or percentage

**Typical range**: -90 to -30 dBm (or 0-100%)

**What it measures**: RSSI (Received Signal Strength Indicator)

**Anomaly indicators**:

- \< -80 dBm: Poor coverage, likely issues
- \< -90 dBm: Unusable
- Dead zones: Areas with consistently poor coverage

---

### 4. Capacity

**Description**: Bandwidth utilization on access point

**Unit**: Percentage (0-100%)

**Typical range**: 10-70% during business hours

**What it measures**: Used bandwidth / Available bandwidth

**Anomaly indicators**:

- \> 80%: Approaching saturation, performance degradation likely
- \> 90%: Severe congestion
- Sustained high usage: Need for capacity expansion

---

### 5. Roaming

**Description**: Latency during client handoff between access points

**Unit**: milliseconds (ms)

**Typical range**: 10-200ms

**What it measures**: Time to complete roaming handshake

**Anomaly indicators**:

- \> 300ms: VoIP calls drop, video stutters
- \> 1000ms: Connection loss
- Failed roams: Client stays on weak AP

---

### 6. Successful Connects

**Description**: Percentage of connection attempts that succeed

**Unit**: Percentage (0-100%)

**Typical range**: 95-100%

**What it measures**: Successful authentications / Total attempts

**Anomaly indicators**:

- \< 95%: Significant user impact
- \< 90%: Critical issue
- Common causes: Authentication failures, weak signal, AP crashes

---

### 7. AP Health

**Description**: Composite health score for access point

**Unit**: Score (0-100)

**Typical range**: 80-100

**What it measures**: Weighted combination of:

- CPU utilization
- Memory usage
- Client count
- Error rates
- Uptime

**Anomaly indicators**:

- \< 70: Degraded performance likely
- \< 50: Critical, AP may be failing
- Sudden drops: Crash, reboot, or hardware issue

---

## Data Format

### Real-Time Stream (WebSocket)

Simple observation format:

```javascript
{
    "type": "metric",
    "timestamp": 1234567890,      // Unix timestamp (seconds)
    "metric": "time_to_connect",  // Metric name (snake_case)
    "value": 45                   // Current observation
}
```

**Notes**:

- Each metric streams independently
- No aggregation or distribution data in real-time stream
- Timestamp is measurement time, not transmission time

### Historical Query Response

Includes observations + computed distribution:

```javascript
{
    "metric": "time_to_connect",
    "start": 1234567890,
    "end": 1234571490,
    "observations": [
        {"timestamp": 1234567890, "value": 45},
        {"timestamp": 1234567900, "value": 42},
        // ... more observations
    ],
    "distribution": {
        "p5": 20,      // 5th percentile
        "p25": 35,     // 25th percentile
        "p50": 42,     // 50th percentile (median)
        "p75": 55,     // 75th percentile
        "p95": 85,     // 95th percentile
        "mean": 44.3,
        "stddev": 12.1
    }
}
```

**Notes**:

- Distribution computed from all observations in time range
- Used for rendering distribution ribbon on chart
- Percentiles show "normal range" (p5-p95)
- Values outside p5-p95 are potential anomalies

---

## Metric Names (Canonical)

Use snake_case for consistency:

- `time_to_connect`
- `throughput`
- `coverage`
- `capacity`
- `roaming`
- `successful_connects`
- `ap_health`

---

## Storage Schema

### TinyFlux (Metrics)

Each observation stored as:

```python
{
    "timestamp": 1234567890,
    "metric": "time_to_connect",
    "value": 45,
    "entity": "AP-Floor3-02",  # Optional: which AP/device
}
```

**Indexes**:

- Primary: timestamp
- Secondary: metric name

**Query pattern**:

```python
db.select('time_to_connect', start=t1, end=t2)
```

---

## Seasonality Patterns

Realistic metrics should show:

**Daily cycles**:

- Peak: Business hours (9am-5pm)
- Trough: Overnight (2am-6am)
- Weekend: Lower overall, flatter curve

**Weekly cycles**:

- Weekdays: Higher usage
- Weekends: 30-50% of weekday levels

**Noise**:

- Random variation: ±5-15% of mean
- Occasional spikes: Anomalies, events
- Gradual drift: System aging, growth

---

## Event Correlation

Metrics that change when events occur:

| Event Type           | Affected Metrics        | Expected Change          |
| -------------------- | ----------------------- | ------------------------ |
| Device restart       | All metrics for that AP | Spike → return to normal |
| Firmware update      | AP Health               | Temporary degradation    |
| Client surge         | Capacity, Throughput    | Increase                 |
| Interference         | Coverage, Throughput    | Decrease                 |
| Configuration change | Varies                  | Depends on change        |

---

## Distribution Interpretation

The distribution ribbon on charts shows:

- **Dark center** (p25-p75): Normal operating range
- **Medium gradient** (p5-p25, p75-p95): Occasional variance
- **Faint edges** (< p5, > p95): Rare events, likely anomalies

**Visual cues**:

- Wide distribution: High variance, less predictable
- Narrow distribution: Stable, predictable behavior
- Bimodal: Two distinct operating modes (e.g., day/night)
- Shifting center: Trend, drift, or degradation
