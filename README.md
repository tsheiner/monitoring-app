# Network Monitoring Simulator

## What This Is

This is a data engine for prototyping. It generates realistic WiFi network
monitoring data — complete with time-of-day rhythms, gradual degradations,
sudden events, and automatic recovery — so that any number of UIs, AI chat
interfaces, or alerting systems can be built against it without requiring a
live production network.

The simulation is the product. The included browser-based dashboard exists
only to visualize the output and confirm the data structures look right.
The underlying engine can drive anything: an executive demo, an AI assistant
trained on realistic telemetry, an alerting prototype, or a novel monitoring
interface.

```
┌──────────────────┐     ┌──────────────┐     ┌────────────────────────────┐
│  Simulation      │────→│  Data Store  │────→│  Any Consumer              │
│  Engine          │     │  (30-day     │     │  UI · AI Chat · Alerting   │
│                  │     │   rolling)   │     │  · Demo · New Prototype    │
└──────────────────┘     └──────────────┘     └────────────────────────────┘
         │                      ↑
         │  streams every       │ queries historical data
         │  10 seconds          │ (HTTP API, port 5011)
         └──────────────────────┘
         also broadcasts live via WebSocket (port 5010)
```

---

## The Seven Metrics

The simulator produces seven industry-standard WiFi health metrics for every
access point in the network. Each metric is updated every 10 seconds and
reflects realistic units, ranges, and time-of-day behavior.

| Metric               | What It Measures                                   | Units / Range        |
|----------------------|----------------------------------------------------|----------------------|
| successful_connects  | Percentage of connection attempts that complete    | 0 – 100 %            |
| time_to_connect      | Median time from probe to IP address assignment    | milliseconds         |
| capacity             | Available bandwidth headroom across the radio cells| 0 – 100 (index)      |
| throughput           | Actual layer-2 data throughput efficiency          | 0 – 100 (index)      |
| coverage             | RF signal quality across the coverage area         | 0 – 100 (index)      |
| roaming              | Quality and speed of client handoffs between APs   | 0 – 100 (index)      |
| ap_health            | Overall access point hardware and software health  | 0 – 100 (index)      |

These seven metrics represent the full lifecycle of a wireless connection:
from signal quality (coverage), to joining the network (successful_connects,
time_to_connect), to sustained performance (throughput, capacity, roaming),
to the health of the hardware delivering it (ap_health).

---

## How the Simulation Works

Each metric value is not set directly. Instead, it is computed from a set
of underlying infrastructure sub-components called **classifiers**. Events
cause changes to classifiers, and those changes ripple upward into the metrics.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                        Causal Pipeline                                    │
│                                                                           │
│   Something        A temporary         Classifier        Metric value    │
│   happens    ────→ effect is     ────→ health score ────→ reflects the   │
│   on the           applied to          shifts up or       change         │
│   network          a classifier        down               automatically  │
│                                                                           │
│   (event)          (perturbation)      (0.0 – 1.0)       (derived)      │
└───────────────────────────────────────────────────────────────────────────┘
```

**Events** are discrete occurrences: a device restart, an interference spike,
a DHCP server under load. Each event type targets specific classifiers with
specific magnitudes and recovery shapes.

**Perturbations** are the temporary effects events create. They degrade (or
occasionally improve) one or more classifier scores for a defined duration,
then decay according to one of four shapes: exponential, linear,
sudden_recovery, or gradual_improvement.

**Classifiers** are the simulation primitive. Each represents a specific
infrastructure sub-component. When a classifier's score drops, every metric
that depends on it automatically reflects the degradation.

**Metrics** are weighted averages of their classifiers. The weights are fixed
and reflect each classifier's real-world contribution to the metric.

---

## Classifiers: The Heart of the Simulation

A classifier is a single infrastructure sub-component represented as a health
score between 0.0 (completely degraded) and 1.0 (perfect). Each classifier
has its own independent noise process, its own initial health level, and its
own sensitivity to perturbation events.

The power of this design is **shared classifiers**. The dhcp classifier, for
example, is used by both successful_connects and time_to_connect. A DHCP
server problem automatically degrades both metrics simultaneously — exactly as
it would on a real network — without any special-case logic.

```
  Example: a dhcp_server_overload event
  ─────────────────────────────────────────────────────────────────────────
  dhcp classifier  ────────────────────→  successful_connects  (dhcp: 40%)
                   └──────────────────→  time_to_connect      (dhcp: 40%)

  No other metrics are affected. The two that share dhcp move together.
  ─────────────────────────────────────────────────────────────────────────
```

There are **23 classifiers** in total, organized by the metric group they
primarily serve. The table below is the definitive classifier-metric mapping.
Weights show each classifier's contribution to its parent metric.

| Metric               | Classifiers and Weights                                                                                              |
|----------------------|----------------------------------------------------------------------------------------------------------------------|
| successful_connects  | association 20% · authorization 25% · dhcp 40% · dns 15%                                                            |
| time_to_connect      | association 20% · authorization 25% · dhcp 40% · dns 15%                                                            |
| capacity             | client_density 40% · cochannel_interference 25% · nonwifi_interference 15% · cca_busy 20%                           |
| throughput           | airtime_utilization 35% · channel_width 25% · retry_rate 25% · cca_busy 15%                                         |
| coverage             | signal_strength 35% · ap_density 20% · cell_overlap 10% · low_rssi_clients 15% · client_signal_quality 20%          |
| roaming              | handoff_latency 50% · rssi_tuning 30% · 80211rk_support 20%                                                         |
| ap_health            | cpu 30% · memory 25% · uptime 30% · temperature 15%                                                                 |

```
  Decomposition example: ap_health
  ─────────────────────────────────────────────────────────────
  ap_health
  ├── cpu           30%   CPU utilization (high load = lower score)
  ├── memory        25%   Memory pressure (high pressure = lower score)
  ├── uptime        30%   Restart and crash stability
  └── temperature   15%   Thermal health (heat stress = lower score)
  ─────────────────────────────────────────────────────────────
  Each classifier runs its own mean-reverting noise process.
  Events like heat_event or device_crash suppress specific classifiers.
```

**What each classifier represents:**

- association — 802.11 association success rate
- authorization — RADIUS / 802.1X authentication success rate
- dhcp — DHCP lease acquisition success rate
- dns — DNS resolution success rate
- client_density — client load per radio cell (high density = lower score)
- cochannel_interference — co-channel interference level (high interference = lower score)
- nonwifi_interference — Bluetooth, microwave, and other non-WiFi interference
- airtime_utilization — airtime efficiency across the radio cells
- channel_width — 80 MHz / 160 MHz channel availability
- retry_rate — frame retry rate (high retries = lower score)
- signal_strength — RF signal quality across the coverage area
- ap_density — access point deployment density
- cell_overlap — cell overlap and coverage redundancy
- low_rssi_clients — proportion of clients with low RSSI (high proportion = lower score)
- client_signal_quality — aggregate signal quality score across all associated clients
- cca_busy — clear-channel assessment busy fraction; how much of airtime is unavailable due to detected activity (high = lower score)
- handoff_latency — 802.11 client handoff latency (high latency = lower score)
- rssi_tuning — RSSI threshold tuning quality for roaming decisions
- 80211rk_support — 802.11r/k fast roaming protocol support
- cpu — access point CPU utilization (high CPU = lower score)
- memory — access point memory pressure (high pressure = lower score)
- uptime — AP stability; restarts and crashes degrade this score
- temperature — device temperature (thermal stress = lower score)

---

## Events and Perturbations

Events are the mechanism by which things *happen* in the network. The
simulator fires events continuously on a realistic schedule. Each event type
targets specific classifiers with a defined magnitude and decay behavior.

```
  Event cascade example: interference_event
  ──────────────────────────────────────────────────────────────────────────
     interference_event
          │
          ├──→ cochannel_interference  −0.30  (sudden_recovery, 5 min)
          │         └──→  capacity metric degrades automatically
          │
          ├──→ retry_rate              −0.20  (sudden_recovery, 5 min)
          │         └──→  throughput metric degrades automatically
          │
          └──→ signal_strength         −0.15  (sudden_recovery, 5 min)
                    └──→  coverage metric degrades automatically
  ──────────────────────────────────────────────────────────────────────────
  Three metrics degrade from one event. All recover automatically.
```

**All 13 event types and their classifier targets:**

| Event Type              | Classifiers Affected                                     | Recovery Shape       |
|-------------------------|----------------------------------------------------------|----------------------|
| device_restart          | uptime, cpu                                              | exponential          |
| device_crash            | uptime, cpu, client_density                              | exponential          |
| firmware_update         | uptime, cpu                                              | exponential          |
| heat_event              | temperature, cpu                                         | sudden_recovery      |
| dhcp_server_overload    | dhcp                                                     | exponential          |
| radius_timeout          | authorization                                            | exponential          |
| dns_resolution_failure  | dns                                                      | exponential          |
| interference_event      | cochannel_interference, retry_rate, signal_strength, cca_busy | sudden_recovery  |
| high_density_event      | client_density, airtime_utilization                      | linear               |
| rogue_ap                | cell_overlap, retry_rate                                 | sudden_recovery      |
| config_change           | channel_width                                            | exponential          |
| channel_change          | channel_width, rssi_tuning                               | exponential          |
| ai_action               | channel_width, client_density                            | gradual_improvement  |

**Recovery shapes** determine how a classifier returns to normal after an event:

- Exponential — fast initial impact, gradual tail recovery (most common)
- Linear — steady uniform recovery over the full duration
- Sudden recovery — full effect for 80% of duration, then rapid snap to normal
- Gradual improvement — starts at zero effect, ramps upward (used for ai_action
  events where the optimization benefit takes time to materialize)

---

## What Makes the Data Look Real

Four mechanisms combine to give each metric a distinct, realistic character.

**1. Daily profiles (diurnal patterns)**

Every metric has its own smooth time-of-day curve derived from how that metric
behaves on a real network. capacity and throughput peak during business hours
when the most clients are active. time_to_connect degrades slightly during
morning login rushes. ap_health varies more at night when maintenance windows
run. These are deterministic, sinusoidal curves — not random. They give each
metric a recognizable daily shape.

**2. Mean-reverting noise (Ornstein-Uhlenbeck process)**

On top of the daily profile, each classifier runs its own Ornstein-Uhlenbeck
noise process — a continuous, mean-reverting random walk. It drifts randomly
from moment to moment but always gravitates back toward its natural resting
level. This produces the kind of subtle, organic variation you see in real
network telemetry: no sharp unnatural jumps, no drift to infinity, just
realistic short-term fluctuation. Each classifier has its own mean-reversion
rate and noise amplitude.

**3. Bootstrap — 30 days of simulated history**

When the backend starts, it generates 30 days of simulated history before
serving any live data. This bootstrap process runs the full simulation
(classifiers, noise, daily profiles) at accelerated speed to produce a deep
historical record. From this history, it computes statistical baselines for
each metric — the percentile distributions that define what "normal" looks
like at every hour of the day. Health status thresholds (green / yellow / red)
are derived from these bootstrap observations, not hardcoded, so they are
always consistent with the simulated network's actual behavior.

**4. Environmental condition: client_load**

client_load is a special environmental variable that represents human activity
— the number of people actively using the network. It runs its own
mean-reverting noise process and follows its own diurnal curve. When
client_load is high, classifiers like client_density and airtime_utilization
naturally feel more pressure. This creates realistic coupling across multiple
metrics without requiring hard-coded correlation rules: a busy morning
organically degrades capacity, throughput, and connection times together.

---

## Network Profiles

The simulator ships with three network environment profiles. Each profile
defines the AP topology, metric baseline values, and timing patterns
appropriate for that type of facility.

**Enterprise** — A standard office environment with business-hours usage
patterns. Client load peaks on weekday mornings and afternoons. Network usage
is predictable and moderate. This is the default profile.

**Campus** — A university environment with class schedules, labs, and dorm
usage. Distinct demand spikes correspond to class periods. Evening and weekend
patterns differ sharply from enterprise. High-density areas like lecture halls
create periodic capacity stress.

**Hospital** — A 24/7 critical-care facility with high reliability
requirements and unusual load patterns. The network must maintain performance
around the clock. There is no quiet night — clinical devices, monitoring
systems, and shift handovers create continuous demand.

The active profile is selected at startup via the NETWORK_PROFILE environment
variable. Switching profiles changes the feel and character of the data
without changing the simulation architecture.

---

## The Data Pipeline

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Bootstrap (runs at startup, takes ~30–60 seconds)                   │
  │  Simulates 30 days of history → computes baselines → stores in tiers │
  └───────────────────────────────────┬──────────────────────────────────┘
                                      │
                                      ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Tiered Storage (automatic aggregation by age)                       │
  │                                                                      │
  │  raw (10s)  →  1-min  →  5-min  →  15-min  →  1-hour  →  12-hour   │
  │  last 2h       2–3h     3–6h      6–18h      18h–4d     up to 30d   │
  └───────────────────────────────────┬──────────────────────────────────┘
                                      │
                      ┌───────────────┴──────────────────┐
                      ▼                                  ▼
  ┌─────────────────────────┐        ┌─────────────────────────────────┐
  │  HTTP API  (port 5011)  │        │  WebSocket stream  (port 5010)  │
  │  Historical queries,    │        │  Live broadcast every 10 sec    │
  │  baselines, events      │        │  to all connected consumers     │
  └─────────────────────────┘        └─────────────────────────────────┘
                      │                                  │
                      └──────────────┬───────────────────┘
                                     ▼
                     ┌────────────────────────────────┐
                     │  Browser Dashboard (port 5012) │
                     │  or any other consumer         │
                     └────────────────────────────────┘
```

The tiered storage system automatically selects the right resolution for any
time range: full 10-second resolution for the last two hours, progressively
coarser buckets as data ages, with a 30-day rolling window maintained by
automatic daily cleanup.

---

## Running the Application

**What you need installed:** Python 3.11 with conda, and Node.js (any recent
version).

**Start the backend**

From the backend/ folder, activate the monitoring-app conda environment and
run main.py. The backend will:

1. Run the bootstrap phase — generates 30 days of simulated history and
   computes statistical baselines (takes about 30 to 60 seconds)
2. Begin streaming live observations every 10 seconds

The HTTP API is available at port 5011. The WebSocket stream starts on
port 5010. Both are ready after the bootstrap phase completes.

**Start the frontend**

From the frontend/ folder, run npm install (first time only), then npm run dev.
The dashboard opens at port 5012.

**What you will see**

A time-series chart showing all seven metrics as stacked traces. Behind each
metric trace, a soft distribution ribbon shows the expected percentile range
for that time of day (derived from the bootstrap baselines). When events fire,
vertical markers appear on the chart and the affected metrics visibly degrade
and recover. All seven metric traces update live every 10 seconds.

**Ports at a glance:**

| Service               | Address                   |
|-----------------------|---------------------------|
| HTTP API              | http://localhost:5011     |
| WebSocket stream      | ws://localhost:5010       |
| Browser dashboard     | http://localhost:5012     |
