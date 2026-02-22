# Data Access Guide

How to get network monitoring data from the simulator backend. This
document is written for any consumer — a custom dashboard, an AI agent,
an MCP server, an alerting pipeline, or a notebook doing ad-hoc analysis.
It covers every endpoint, every field, and the mental model you need to
query effectively.

---

## Quick orientation

The backend exposes two interfaces:

| Interface | Address | Purpose |
|-----------|---------|---------|
| **HTTP API** | `http://localhost:5011` | Historical queries, baselines, events, classifier breakdowns |
| **WebSocket** | `ws://localhost:5010` | Live stream — new data every 10 seconds |

Both serve JSON. The HTTP API is FastAPI (so you also get interactive docs
at `/docs`). The WebSocket is broadcast-only — connect, receive, no
client-to-server messages needed.

---

## Core concepts

### Metrics

There are **7 metrics**, each updated every 10 seconds:

| Metric | What it measures | Value semantics |
|--------|-----------------|-----------------|
| `successful_connects` | % of connection attempts that complete | 0–100 (percentage) |
| `time_to_connect` | Median time to get an IP address | milliseconds |
| `capacity` | Available bandwidth headroom | 0–100 (index) |
| `throughput` | Layer-2 data throughput efficiency | 0–100 (index) |
| `coverage` | RF signal quality across the area | 0–100 (index) |
| `roaming` | Client handoff quality between APs | 0–100 (index) |
| `ap_health` | Hardware/software health of APs | 0–100 (index) |

### Classifiers (sub-components)

All seven metrics are decomposed into **classifiers** — the
infrastructure sub-components that explain *why* a metric has its current
value. Each classifier is a health score between 0.0 (degraded) and 1.0
(perfect).

| Metric | Classifiers (weight) |
|--------|---------------------|
| `successful_connects` | association (20%), authorization (25%), dhcp (40%), dns (15%) |
| `time_to_connect` | association (20%), authorization (25%), dhcp (40%), dns (15%) |
| `capacity` | client_density (50%), cochannel_interference (30%), nonwifi_interference (20%) |
| `throughput` | airtime_utilization (45%), channel_width (25%), retry_rate (30%) |
| `coverage` | signal_strength (50%), ap_density (30%), cell_overlap (20%) |
| `roaming` | handoff_latency (50%), rssi_tuning (30%), 80211rk_support (20%) |
| `ap_health` | cpu (30%), memory (25%), uptime (30%), temperature (15%) |

When you see a metric value degrade, the classifier breakdown tells you
which sub-component is responsible — exactly the "Failure contributors"
panel in a typical network assurance UI.

### Entities

Each metric is generated per access point (e.g., `AP-Floor1-01`,
`AP-Floor2-03`). The API can return:

- **Aggregated** (`entity=_aggregated`, the default) — the mean across
  all APs for each timestamp. This is what you want for a network-wide
  summary view.
- **All entities** (`entity=_all`) — every per-AP observation separately.
  Use this for per-device drill-down or heatmap-style views.
- **Single entity** (`entity=AP-Floor1-01`) — one specific AP.

### Events

Events are discrete occurrences that cause metric changes (device
restarts, interference spikes, DHCP overloads, etc.). Each event targets
specific classifiers, which cascade into metric values automatically.

### Baselines

Baselines are statistical distributions of what each metric "normally"
looks like at every hour of the day, computed from 30 days of simulated
history. Use them for anomaly ribbons, expected-range shading, or
threshold derivation.

---

## HTTP API reference

### Check availability

```
GET /
```

Response:
```json
{
  "status": "ok",
  "service": "network-monitoring-api",
  "version": "1.0.0"
}
```

If the bootstrap phase is still running (~30–60 seconds at startup), the
server won't be available yet.

---

### List available metrics

```
GET /api/metrics
```

Response:
```json
{
  "metrics": [
    "successful_connects",
    "time_to_connect",
    "capacity",
    "throughput",
    "coverage",
    "roaming",
    "ap_health"
  ]
}
```

---

### Get metric observations (historical)

This is the primary data endpoint. It returns time-series observations
with optional classifier decomposition.

```
GET /api/metrics/{metric}?start={unix_seconds}&end={unix_seconds}&entity={entity}
```

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `metric` | yes (path) | — | One of the 7 metric names |
| `start` | yes | — | Start time, Unix seconds |
| `end` | yes | — | End time, Unix seconds (must be > start) |
| `entity` | no | `_aggregated` | `_aggregated`, `_all`, or a specific AP name |

**Response:**

```json
{
  "metric": "throughput",
  "start": 1708300000,
  "end": 1708310000,
  "observations": [
    {
      "timestamp": 1708300000,
      "metric": "throughput",
      "value": 78.3,
      "entity": null,
      "classifiers": [
        {
          "name": "airtime_utilization",
          "value": 0.852,
          "status": "green",
          "contribution": 0.001,
          "weight": 0.45
        },
        {
          "name": "channel_width",
          "value": 0.910,
          "status": "green",
          "contribution": 0.000,
          "weight": 0.25
        },
        {
          "name": "retry_rate",
          "value": 0.946,
          "status": "green",
          "contribution": -0.002,
          "weight": 0.30
        }
      ]
    }
  ],
  "distribution": {
    "p1": 52.1,
    "p5": 58.4,
    "p10": 62.0,
    "p25": 68.7,
    "p50": 76.2,
    "p75": 83.1,
    "p90": 88.5,
    "p95": 91.7,
    "p99": 96.0,
    "mean": 75.8,
    "stddev": 10.3,
    "count": 1000
  }
}
```

**Key details:**

- `observations` is ordered by timestamp, ascending.
- `value` is in the metric's native units (see the metrics table above).
- `entity` is `null` when aggregated, or the AP name otherwise.
- `classifiers` may be `null` for older historical data that was generated
  before classifier payloads were included.
- `distribution` summarizes the entire queried range. Use it for quick
  statistical context (e.g., "this metric's median was 76.2 over the
  last 2 hours").

**Classifier fields explained:**

| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | Classifier name (e.g., `"dhcp"`) |
| `value` | float | Current health score, 0.0–1.0 |
| `status` | string | `"green"`, `"yellow"`, or `"red"` — based on bootstrap-derived hourly thresholds |
| `contribution` | float | `weight × (current_value − initial_level)` — how much this classifier is pulling the metric up or down relative to its baseline |
| `weight` | float | This classifier's fixed weight in the metric calculation |

**Resolution and tiered storage:**

The backend automatically stores data at different resolutions depending
on age. When you query a time range, you get whatever resolution is stored:

| Data age | Resolution |
|----------|-----------|
| 0–2 hours | 10 seconds (raw) |
| 2–3 hours | 1 minute |
| 3–6 hours | 5 minutes |
| 6–18 hours | 15 minutes |
| 18 hours–4 days | 1 hour |
| 4–10 days | 6 hours |
| 10–30 days | 12 hours |

You do not need to specify resolution — just provide your time range and
the response will contain observations at the appropriate granularity.
A query spanning multiple tiers will return mixed-resolution data (finer
for recent, coarser for older).

---

### Get baseline distributions

Baselines tell you what "normal" looks like at every hour of the day.
Use them to draw expected-range ribbons behind time series, compute
anomaly scores, or set dynamic thresholds.

```
GET /api/metrics/{metric}/baseline?lookback_days={days}&entity={entity}&tz={timezone}
```

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `metric` | yes (path) | — | Metric name |
| `lookback_days` | no | 30 | Days of history to compute from (1–90) |
| `entity` | no | null | AP name for per-device baseline, or omit for network-wide |
| `tz` | no | local | Timezone for hour grouping (e.g., `"UTC"`, `"America/New_York"`) |

**Response:**

```json
{
  "metric": "throughput",
  "entity": null,
  "lookback_days": 30,
  "timezone": "local",
  "hourly_distributions": [
    {
      "hour": 0,
      "distribution": {
        "p1": 52.1,
        "p5": 58.4,
        "p10": 62.0,
        "p25": 68.7,
        "p50": 76.2,
        "p75": 83.1,
        "p90": 88.5,
        "p95": 91.7,
        "p99": 96.0,
        "mean": 75.8,
        "stddev": 10.3,
        "count": 2500
      },
      "fallback_source": "data",
      "sample_count": 2500
    },
    {
      "hour": 1,
      "distribution": { "..." : "..." },
      "fallback_source": "data",
      "sample_count": 2480
    }
  ]
}
```

The response contains 24 entries (hours 0–23). Each entry has:

- `distribution` — full percentile spread for that hour.
- `fallback_source` — where the data came from:
  - `"data"` — computed from real stored observations (ideal).
  - `"entity_4h_bin"` — used a wider 4-hour window (sparse entity data).
  - `"global_scaled"` — used network-wide data scaled to this entity.
  - `"synthetic_config"` — generated synthetically (no data available).
- `sample_count` — how many observations contributed.

**How to use baselines for chart ribbons:**

For each data point you plot, look up its hour-of-day in the baseline
response. Use `p5`/`p95` (or `p10`/`p90`) as the ribbon bounds. Points
outside this range are anomalous relative to the 30-day historical norm
for that time of day.

---

### Get events

```
GET /api/events?start={unix_seconds}&end={unix_seconds}&event_type={type}&entity={entity}&severity={severity}
```

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `start` | yes | — | Start time, Unix seconds |
| `end` | yes | — | End time, Unix seconds |
| `event_type` | no | all | Filter: `device_restart`, `device_crash`, `firmware_update`, `heat_event`, `dhcp_server_overload`, `radius_timeout`, `dns_resolution_failure`, `interference_event`, `high_density_event`, `rogue_ap`, `config_change`, `channel_change`, `ai_action` |
| `entity` | no | all | Filter by AP name |
| `severity` | no | all | Filter: `info`, `warning`, `critical` |

**Response:**

```json
{
  "start": 1708300000,
  "end": 1708310000,
  "events": [
    {
      "id": 42,
      "timestamp": 1708305000,
      "event_type": "device_restart",
      "severity": "warning",
      "entity": "AP-Floor2-01",
      "message": "AP-Floor2-01 rebooted unexpectedly",
      "metadata": {
        "previous_uptime": 86400,
        "reason": "watchdog_timeout",
        "initiated_by": "system"
      }
    },
    {
      "id": 43,
      "timestamp": 1708306500,
      "event_type": "interference_event",
      "severity": "warning",
      "entity": "AP-Floor1-03",
      "message": "Interference detected near AP-Floor1-03",
      "metadata": {
        "source": "microwave_oven",
        "affected_channel": 6,
        "severity_dbm": -65.3,
        "estimated_duration_minutes": 5
      }
    }
  ],
  "count": 2
}
```

**Event metadata by type:**

| Event type | Metadata fields |
|-----------|-----------------|
| `device_restart` | `previous_uptime`, `reason`, `initiated_by` |
| `device_crash` | `crash_reason`, `uptime_at_crash`, `last_error` |
| `firmware_update` | `from_version`, `to_version`, `update_method` |
| `config_change` | `changed_by`, `change_type`, `old_value`, `new_value` |
| `ai_action` | `action_type`, `reasoning`, `confidence`, `expected_impact` |
| `interference_event` | `source`, `affected_channel`, `severity_dbm`, `estimated_duration_minutes` |
| Others | `{}` (empty) |

---

### Get current classifier breakdown

Returns the most recent classifier state for a metric. Use this for
"right now" summary panels (the "Failure contributors" view).

```
GET /api/metrics/{metric}/classifiers/current
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `metric` | yes (path) | Metric name |

**Response:**

```json
{
  "metric": "successful_connects",
  "timestamp": 1708310000,
  "value": 97.8,
  "entity": "AP-Floor1-01",
  "classifiers": [
    {
      "name": "association",
      "value": 0.981,
      "status": "green",
      "contribution": 0.000,
      "weight": 0.20
    },
    {
      "name": "authorization",
      "value": 0.965,
      "status": "yellow",
      "contribution": -0.001,
      "weight": 0.25
    },
    {
      "name": "dhcp",
      "value": 0.990,
      "status": "green",
      "contribution": 0.000,
      "weight": 0.40
    },
    {
      "name": "dns",
      "value": 0.995,
      "status": "green",
      "contribution": 0.000,
      "weight": 0.15
    }
  ]
}
```

Returns 404 if the metric has no classifier data available yet.

---

### Get classifier baseline

Returns hourly distributions for a specific classifier (not a metric).
Use this to understand a single infrastructure sub-component's normal
behavior over a 24-hour cycle.

```
GET /api/classifiers/{classifier}/baseline
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `classifier` | yes (path) | One of the 20 classifier names (see table above) |

**Response:**

```json
{
  "classifier": "dhcp",
  "lookback_days": 29,
  "hourly_distributions": [
    {
      "hour": 0,
      "distribution": {
        "p1": 0.980,
        "p5": 0.983,
        "p10": 0.985,
        "p25": 0.988,
        "p50": 0.990,
        "p75": 0.992,
        "p90": 0.994,
        "p95": 0.995,
        "p99": 0.998,
        "mean": 0.990,
        "stddev": 0.004,
        "count": 2500
      },
      "sample_count": 2500
    }
  ]
}
```

Returns 503 if baselines haven't been computed yet (backend still bootstrapping).

---

## WebSocket live stream

### Connecting

```
ws://localhost:5010
```

No handshake, no authentication, no subscription messages. Connect and
you immediately start receiving JSON messages. The server broadcasts
to all connected clients.

### Message types

Every message has a `"type"` field as discriminator.

#### Metric update (`type: "metric"`)

Broadcast every **10 seconds**, one message per metric (7 messages per
tick). Values are aggregated across all APs.

```json
{
  "type": "metric",
  "timestamp": 1708310000,
  "metric": "throughput",
  "value": 78.3,
  "entity": null,
  "classifiers": [
    {
      "name": "airtime_utilization",
      "value": 0.852,
      "status": "green",
      "contribution": 0.001,
      "weight": 0.45
    },
    {
      "name": "channel_width",
      "value": 0.910,
      "status": "green",
      "contribution": 0.000,
      "weight": 0.25
    },
    {
      "name": "retry_rate",
      "value": 0.946,
      "status": "green",
      "contribution": -0.002,
      "weight": 0.30
    }
  ]
}
```

- `entity` is always `null` (aggregated broadcast).
- `classifiers` is present for `ap_health` the same as other metrics.
- Classifier values/statuses are aggregated (mean value, majority-vote
  status across APs).

#### Event (`type: "event"`)

Broadcast when events fire (random timing, roughly every ~5 minutes).

```json
{
  "type": "event",
  "timestamp": 1708310500,
  "event_type": "device_restart",
  "severity": "warning",
  "entity": "AP-Floor2-01",
  "message": "AP-Floor2-01 rebooted unexpectedly",
  "metadata": {
    "previous_uptime": 86400,
    "reason": "watchdog_timeout",
    "initiated_by": "system"
  }
}
```

Same shape as events from the HTTP API, plus the `"type": "event"`
discriminator.

---

## Common access patterns

These recipes show how to combine endpoints for typical use cases.

### 1. Dashboard summary (like the reference assurance overview)

**Goal:** Show each metric's current value, a time-series chart, and
a classifier breakdown panel.

```
For each of the 7 metrics:
  1. GET /api/metrics/{metric}?start={2_hours_ago}&end={now}
     → Plot observations[].value over observations[].timestamp
     → Show the most recent observation's value as the headline number

  2. GET /api/metrics/{metric}/baseline
     → For each plotted point, look up its hour in hourly_distributions
     → Use p5/p95 as ribbon bounds behind the time series

  3. GET /api/metrics/{metric}/classifiers/current
     → Display each classifier's name, value, and status (green/yellow/red)
     → Sort by contribution to highlight which sub-components are dragging
       the metric down

Also:
  4. GET /api/events?start={2_hours_ago}&end={now}
     → Overlay event markers on the time-series charts
```

### 2. AI agent analyzing network health

**Goal:** Understand current state and recent history to answer
questions like "Why is throughput low?"

```
1. GET /api/metrics
   → Get the list of all metrics

2. For each metric (or the one in question):
   GET /api/metrics/{metric}?start={1_hour_ago}&end={now}
   → Check current value vs. the distribution (is it below p25? below p5?)

3. GET /api/metrics/{metric}/classifiers/current
   → Identify which classifiers have status "yellow" or "red"
   → A classifier with negative contribution is actively pulling the
     metric down

4. GET /api/events?start={1_hour_ago}&end={now}
   → Correlate: did an event fire that targets the degraded classifiers?
   → Use the event metadata for root-cause detail
```

**Example reasoning chain:**
- throughput value is at p8 (below normal)
- classifier `retry_rate` has status `"red"`, contribution `-0.03`
- event `interference_event` fired 12 minutes ago targeting `retry_rate`
- → conclusion: interference is causing high frame retries, degrading throughput

### 3. Alerting system

**Goal:** Fire alerts when metrics deviate from historical norms.

```
1. GET /api/metrics/{metric}/baseline
   → Cache hourly distributions (refresh daily)

2. Connect to WebSocket ws://localhost:5010
   → On each metric message:
     - Look up current hour's baseline distribution
     - Compare message.value to thresholds (e.g., below p5 = warning,
       below p1 = critical)
     - If alerting: use classifiers to auto-populate "probable cause"
```

### 4. Trend analysis over days/weeks

**Goal:** See how a metric has trended over the past week.

```
GET /api/metrics/{metric}?start={7_days_ago}&end={now}
→ Returns ~170 points (mix of 1-hour and 6-hour resolution)
→ Plot as a trend line; resolution is coarser but smooth enough for
  multi-day views
```

### 5. Per-device drill-down

**Goal:** Investigate a specific AP.

```
GET /api/metrics/{metric}?start={start}&end={end}&entity=AP-Floor2-01
→ Returns observations for only that AP

GET /api/events?start={start}&end={end}&entity=AP-Floor2-01
→ Returns events affecting only that AP
```

### 6. Compare all APs

```
GET /api/metrics/{metric}?start={start}&end={end}&entity=_all
→ Returns per-AP observations — one series per entity
→ Use for heatmaps, comparative tables, or outlier detection
```

---

## Timestamps

All timestamps in the API are **Unix seconds** (integer). The WebSocket
stream uses the same convention. Convert to your display timezone on the
client side.

```python
import time
now = int(time.time())
two_hours_ago = now - 7200
```

```javascript
const now = Math.floor(Date.now() / 1000);
const twoHoursAgo = now - 7200;
```

---

## Network profiles

The backend starts with one of three simulated environments, controlled
by the `NETWORK_PROFILE` environment variable:

| Profile | Character |
|---------|-----------|
| `enterprise` (default) | Business-hours peaks, moderate load, predictable |
| `campus` | Class-schedule spikes, dorm evenings, high-density lecture halls |
| `hospital` | 24/7 load, no quiet periods, high reliability baseline |

The profile affects AP topology, baseline values, and diurnal patterns,
but does **not** change the API interface. All endpoints work identically
regardless of profile.

---

## Error handling

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 404 | Unknown metric name, unknown classifier, or no data available |
| 422 | Invalid parameters (missing required fields, end <= start) |
| 503 | Backend still bootstrapping — try again in 30–60 seconds |

All error responses include a JSON body with a `"detail"` field:

```json
{
  "detail": "Unknown metric: foobar"
}
```
