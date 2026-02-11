# Simulator Design

How the network monitoring simulator generates realistic metric and event data.

## Purpose

The simulator is a **data engine** that produces realistic WiFi network monitoring data. It is not tied to any single UI or consumer. The data it generates drives:

- Real-time visualization (charts, distribution ribbons)
- AI agent conversations (the agent "watches" these metrics)
- Alerting and threshold detection
- Any future experience built on network monitoring data

The quality of every downstream experience depends on the realism and structure of this data.

## Core Architecture: Driver-Based Simulation

Instead of generating metric values directly with noise, the simulator models three **underlying continuous drivers** that represent the physical reality of the network. Metrics are **derived** from these drivers, producing naturally correlated, smooth traces.

```
┌──────────────────────────────────────────────────────┐
│                 Network Profile                       │
│           (config_enterprise.json, etc.)              │
│                                                       │
│  Defines: metric bounds, driver OU parameters,       │
│  AP topology, time patterns                          │
└─────────────────────┬────────────────────────────────┘
                      │ configures
                      v
┌──────────────────────────────────────────────────────┐
│            RealisticMetricsGenerator                  │
│                                                       │
│  Three Drivers (per-AP, Ornstein-Uhlenbeck process): │
│  ┌─────────────┐ ┌─────────────┐ ┌───────────────┐  │
│  │ client_load │ │ rf_quality  │ │ infra_health  │  │
│  │   (0-1)     │ │   (0-1)     │ │    (0-1)      │  │
│  │ Daily rhythm│ │ Mostly      │ │ Event-driven  │  │
│  │ + topology  │ │ stable      │ │ no daily      │  │
│  └──────┬──────┘ └──────┬──────┘ └───────┬───────┘  │
│         │               │                │           │
│         v               v                v           │
│  ┌─────────────────────────────────────────────┐     │
│  │        Metric Derivation Functions          │     │
│  │  value = baseline + Σ(sens × dev × range)   │     │
│  │                                             │     │
│  │  Produces: capacity, throughput, coverage,  │     │
│  │  time_to_connect, roaming, ap_health,       │     │
│  │  successful_connects                        │     │
│  └─────────────────────────────────────────────┘     │
│                                                       │
│  PerturbationManager: active perturbations that      │
│  shift driver values (events → driver effects)       │
└──────────┬───────────────────────────┬───────────────┘
           │ owns                      │ applies effects from
           v                          v
┌────────────────┐          ┌─────────────────────────┐
│ Perturbation   │          │   EventGenerator         │
│ Manager        │◄─────────│                          │
│                │ registers│  Generates events and    │
│ Tracks active  │ driver   │  registers perturbations │
│ perturbations, │ effects  │  that shift drivers      │
│ computes       │          │                          │
│ combined effect│          │                          │
└───────┬────────┘          └──────────────────────────┘
        │ contains
        v
┌────────────────┐
│ Perturbation   │  (one per active event or load pattern)
│                │
│ - start_time   │
│ - duration     │
│ - affected     │
│   drivers +    │
│   magnitudes   │
│ - decay_type   │
└────────────────┘
```

## Why Drivers?

The previous approach generated metric values directly with AR(1) noise. This caused two problems:

1. **Constant jitter** — noise updated every tick, producing unrealistic high-frequency oscillation
2. **Random distribution width** — variance changed for no reason

The driver model solves both:

- **Smooth evolution**: Drivers use Ornstein-Uhlenbeck processes that produce slow, mean-reverting curves
- **Natural correlations**: Multiple metrics respond to the same driver change (a load spike simultaneously affects capacity, throughput, and latency)
- **Causal variance**: Distribution width increases during busy hours *because client_load is higher*, not randomly
- **Fault isolation**: If `infra_health` is solid, an ops person can rule out hardware issues — just like real troubleshooting

## The Three Drivers

### client_load (0-1)

Network demand from connected devices. The primary driver of metric variation.

- **Daily rhythm**: Follows smooth sinusoidal business-hours pattern
  - Night (0-6): ~0.08
  - Morning ramp (6-9): 0.08 → 0.48
  - Business hours (9-16): 0.48-0.66 (afternoon peak)
  - Evening decline (16-19): 0.56 → 0.16
  - Night (19-24): declining to 0.08
- **Weekend**: 40% of weekday levels
- **Per-AP variation**: Topology shifts baseline (dense office +0.15, hallway -0.25)
- **OU parameters**: θ=0.002 (~6 min half-life), σ=0.004

### rf_quality (0-1)

Radio frequency environment quality. Mostly stable with slow drift.

- **Daily pattern**: Slight degradation during business hours (-0.02) from device interference
- **Per-AP variation**: Topology sets baseline (hallway 0.93, problematic AP 0.82)
- **OU parameters**: θ=0.0005 (~23 min half-life), σ=0.001
- **Perturbations**: Interference events drop rf_quality -0.25

### infra_health (0-1)

Infrastructure hardware/software state. Persistent — only changes from events.

- **No daily pattern**: Hardware doesn't care about time of day
- **OU parameters**: θ=0.0003 (~38 min half-life), σ=0.0005 (barely drifts)
- **Perturbations**: Device crashes drop infra_health -0.40, restarts -0.20

## Three Dimensions

Network ops people think about networks along three dimensions:

| Dimension | What it means | How it's modeled |
|-----------|---------------|-----------------|
| **Temporal** | When does it happen? | Daily rhythm on client_load driver, time-of-day patterns |
| **Physical** | Where in the building? | AP topology with roles (lobby, conference, dense office) |
| **Logical** | Which network/segment? | Network profile (enterprise/campus/hospital) |

## Metric Derivation

Each metric is computed from driver values using a sensitivity matrix:

```
value = baseline + Σ(sensitivity × driver_deviation × metric_range)

where driver_deviation = current_driver_value - normal_level
```

### Sensitivity Matrix

| Metric | client_load | rf_quality | infra_health |
|--------|------------|------------|--------------|
| **capacity** | +0.70 | -0.05 | +0.15 |
| **throughput** | -0.25 | +0.20 | +0.30 |
| **time_to_connect** | +0.30 | -0.25 | -0.40 |
| **coverage** | -0.02 | +0.50 | +0.05 |
| **roaming** | +0.20 | -0.20 | -0.20 |
| **successful_connects** | -0.08 | +0.05 | +0.30 |
| **ap_health** | -0.10 | +0.05 | +1.50 |

Reading the table: "When client_load increases, capacity increases (+0.70) but throughput decreases (-0.25)." Signs indicate direction: positive means metric increases when driver increases.

### Example: Device Crash

1. Event creates perturbation: `infra_health: -0.40`
2. infra_health drops from 0.95 to 0.55 (deviation = -0.40)
3. Derived effects (using sensitivity × deviation × range):
   - ap_health: 1.50 × (-0.40) × 27 = **-16 points** (92 → 76)
   - throughput: 0.30 × (-0.40) × 700 = **-84 Mbps** (480 → 396)
   - time_to_connect: -0.40 × (-0.40) × 185 = **+30 ms** (35 → 65)
4. Perturbation decays exponentially over 120 seconds
5. All metrics recover smoothly together

## Ornstein-Uhlenbeck Process

Drivers evolve via the OU process, which produces smooth, mean-reverting random walks:

```
x(t+dt) = μ(t) + (x(t) - μ(t)) × exp(-θ×dt) + noise

where:
  μ(t) = time-varying mean (daily pattern + AP offset)
  θ    = mean reversion rate (higher = faster return to mean)
  noise = σ × √((1 - exp(-2θ×dt)) / (2θ)) × N(0,1)
```

This is the **exact** solution (not Euler approximation), so it works correctly for any time step — including the large gaps during bootstrap (12-hour intervals).

Key properties:
- **Smooth**: Adjacent values are highly correlated
- **Mean-reverting**: Always drifts back toward the daily pattern
- **Stationary variance**: σ²/(2θ) determines the natural spread

## Perturbations

A perturbation is a **temporary, decaying effect on one or more drivers**. Since metrics are derived from drivers, a single driver perturbation naturally cascades to all affected metrics.

### Decay Types

```
exponential         sudden_recovery       gradual_improvement     linear
(device crash)      (interference)        (ai_action)            (shift change)

│██                 │████████              │              ██│     │██
│ ██                │████████              │           ███  │     │ ██
│  ███              │████████              │        ███    │     │  ██
│    ████           │████████              │     ███       │     │   ██
│       ██████      │       ███            │  ███          │     │    ██
│           ██████  │          █            │██             │     │     ██
└─────────────────  └──────────────        └───────────────      └──────────
  fast impact,        sustained then         ramps up to           steady
  gradual recovery    drops off              full effect            fade
```

### Event → Driver Perturbation Templates

| Event | Driver Impacts | Duration | Decay |
|-------|---------------|----------|-------|
| **device_crash** | infra_health -0.40, client_load -0.08 | 120s | exponential |
| **device_restart** | infra_health -0.20, client_load -0.04 | 60s | exponential |
| **firmware_update** | infra_health -0.08 | 30s | exponential |
| **config_change** | rf_quality -0.05 | 20s | exponential |
| **ai_action** | rf_quality +0.08, client_load -0.03 | 60s | gradual_improvement |
| **interference** | rf_quality -0.25 | 300s | sudden_recovery |

### Load Pattern Templates

These are perturbations without corresponding events — normal usage patterns.

| Pattern | Driver Impact | Duration | Frequency |
|---------|-------------|----------|-----------|
| **meeting_room_surge** | client_load +0.15 | 40 min | ~3/business day |
| **large_download** | client_load +0.10 | 10 min | ~1/business day |
| **shift_change** | client_load +0.12 | 20 min | At shift boundaries |

## AP Topology

Each access point has physical and logical characteristics that shift its driver baselines:

### Enterprise Profile

| AP | Role | Load Baseline | RF Baseline | Character |
|----|------|--------------|-------------|-----------|
| AP-Floor1-01 | Lobby | 0.30 | 0.88 | High transient traffic |
| AP-Floor1-02 | Open office | 0.50 | 0.90 | Standard office area |
| AP-Floor2-01 | Conference | 0.35 | 0.91 | Bursty during meetings |
| AP-Floor2-02 | Open office | 0.50 | 0.89 | Standard office area |
| AP-Floor3-01 | Hallway | 0.20 | 0.93 | Low load, good signal |
| AP-Floor3-02 | Dense office | 0.60 | 0.82 | Problematic — high load, weak RF |

## Network Profiles

Three profiles configure the simulation character via driver parameters:

| Profile | Character | client_load σ | rf_quality σ | infra_health σ |
|---------|-----------|--------------|-------------|----------------|
| **enterprise** | Standard office | 0.004 | 0.001 | 0.0005 |
| **campus** | University | 0.006 (volatile) | 0.0015 | 0.0008 |
| **hospital** | 24/7 facility | 0.002 (stable) | 0.0006 | 0.0003 |

Profiles are selected via `NETWORK_PROFILE` environment variable.

## Value Computation Pipeline

When `generate_observation(metric, timestamp)` is called:

```
1. Update Drivers (OU process)
   For each driver (client_load, rf_quality, infra_health):
     μ = daily_pattern(timestamp) + ap_topology_offset
     x_new = μ + (x_old - μ) × exp(-θ×dt) + noise
     Clip to [0, 1]

2. Apply Perturbations
   For each driver:
     driver_value = x_new + Σ(active perturbation effects)
     Clip to [0, 1]

3. Derive Metric
   deviation = driver_value - normal_level  (for each driver)
   value = baseline + Σ(sensitivity × deviation × metric_range)
   Clip to [metric_min, metric_max]

4. Return Observation
   {timestamp, metric, value}
```

## Bootstrap (Historical Data)

The bootstrap process generates ~30 days of historical data with tiered resolution:

| Tier | Duration | Interval | Points/Metric |
|------|----------|----------|---------------|
| 12-hour | 20 days | 43,200s | 40 |
| 6-hour | 6 days | 21,600s | 24 |
| 1-hour | 3 days | 3,600s | 72 |
| 15-min | 12 hours | 900s | 48 |
| 5-min | 3 hours | 300s | 36 |
| 1-min | 1 hour | 60s | 60 |
| Raw (10s) | 2 hours | 10s | 720 |

Bootstrap runs in two phases:
1. **Generate events** with Poisson timing (~1/hour), register their perturbations with driver-level effects
2. **Generate metrics** across all tiers — perturbations shift drivers, so metrics at event timestamps reflect the cascading impact

## Live Operation

After bootstrap, the system enters live mode:

- **Metrics**: Generated every 10 seconds, broadcast via WebSocket
- **Events**: Generated with Poisson timing (avg 5 min interval, 40% emission probability)
- **Perturbations**: Created automatically when events fire, decay naturally over time
- **Load patterns**: Injected randomly during business hours

## File Map

| File | Role |
|------|------|
| [realistic_generator.py](../backend/simulator/realistic_generator.py) | Driver-based metrics generator with OU process and metric derivation |
| [perturbations.py](../backend/simulator/perturbations.py) | Perturbation class, manager, event/load templates (driver-level effects) |
| [event_generator.py](../backend/simulator/event_generator.py) | Event generation, scheduling, driver perturbation wiring |
| [bootstrap.py](../backend/simulator/bootstrap.py) | Historical data generation with tiered aggregation |
| [config_enterprise.json](../backend/simulator/config_enterprise.json) | Enterprise office profile with AP topology |
| [config_campus.json](../backend/simulator/config_campus.json) | University campus profile |
| [config_hospital.json](../backend/simulator/config_hospital.json) | Hospital 24/7 profile |
| [main.py](../backend/main.py) | Orchestrates bootstrap, live streaming, event wiring |
