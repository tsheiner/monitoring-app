# Mock Data Tools Research

Resources for building the statistical behavior simulator and event stream for the monitoring prototype.

---

## Summary of Approach

We need tools that support:
1. **Statistical behavior models** - not fake topology, but realistic metric distributions
2. **Preset network profiles** - small site, campus, multi-branch retail, etc.
3. **Real-time streaming** with historical persistence
4. **Correlated events and metrics** - causally linked, scenario-triggerable
5. **Adjustable model parameters** - for "what-if" predictions

---

## Time Series Generation

### Synthetic Data Generators

| Tool | Description | Best For |
|------|-------------|----------|
| [ydata-synthetic](https://github.com/ydataai/ydata-synthetic) | GANs for synthetic time series (TimeGAN, DoppelGANger) | Learning realistic patterns from sample data |
| [tsgm](https://github.com/AlexanderVNikitin/tsgm) | Synthetic time series generation and augmentation | Data augmentation, testing |
| [gretel-synthetics](https://github.com/gretelai/gretel-synthetics) | DoppelGANger implementation, 40x faster than TF1 | High-quality synthetic data |

### Probabilistic Forecasting (Model-Based)

| Tool | Description | Best For |
|------|-------------|----------|
| [GluonTS](https://github.com/awslabs/gluonts) | AWS probabilistic time series modeling + Chronos pretrained models | Zero-shot forecasting, uncertainty quantification |
| [Darts](https://github.com/unit8co/darts) | User-friendly forecasting with probabilistic outputs, conformal prediction | Distribution forecasting, anomaly detection |
| [Orbit](https://github.com/uber/orbit) | Bayesian time series from Uber | Probabilistic forecasting with uncertainty |
| [PyFlux](https://github.com/RJT1990/pyflux) | Full Bayesian probabilistic models | Complete uncertainty picture |
| [PyDLM](https://github.com/wwrechard/pydlm) | Bayesian dynamic linear models | State-space modeling |

### Simple Pattern Generation

| Tool | Description | Best For |
|------|-------------|----------|
| [Faker](https://github.com/joke2k/faker) | General synthetic data with date/time providers | Quick prototyping, structure |
| [sensor_data_generator](https://github.com/yukim/sensor_data_generator) | Fake IoT sensor data with Kafka support | IoT metric simulation |

---

## Event Stream Simulation

### Discrete Event Simulators

| Tool | Description | Best For |
|------|-------------|----------|
| [Simulus](https://github.com/liuxfiu/simulus) | Process-oriented discrete event simulator | Complex event scenarios |
| [DE-Sim](https://github.com/KarrLab/de_sim) | Object-oriented, reproducible simulations | Configurable, repeatable scenarios |
| [ns.py](https://github.com/TL-System/ns.py) | Pythonic network simulator based on SimPy | Network-specific event modeling |
| [DEVSimPy](https://github.com/capocchi/DEVSimPy) | DEVS modeling with GUI | Visual scenario design |

### Web/Traffic Event Generators

| Tool | Description | Best For |
|------|-------------|----------|
| [Eventsim](https://github.com/Interana/eventsim) | Generates user event streams, Kafka output | User behavior patterns |
| [OESpy](https://gwagner57.github.io/oes/Python/index.html) | Object Event Simulation with scenarios and experiments | Structured scenario modeling |

---

## Telemetry & Monitoring Mock Data

### OpenTelemetry Generators

| Tool | Description | Best For |
|------|-------------|----------|
| [otelgen](https://github.com/krzko/otelgen) | Synthetic OTLP logs, metrics, traces (gRPC/HTTP) | Testing OTEL pipelines |
| [cisco-open/test-telemetry-generator](https://github.com/cisco-open/test-telemetry-generator) | Cisco's OTEL test data generator | **Directly relevant** - Cisco-authored |
| [lightstep/telemetry-generator](https://github.com/lightstep/telemetry-generator) | OTEL receiver for configurable metrics/traces | Service emulation |

### SNMP Simulators

| Tool | Description | Best For |
|------|-------------|----------|
| [snmpsim](https://github.com/etingof/snmpsim) | Full SNMP agent simulator, record from real devices | Realistic device simulation |
| [snmpsim-data](https://github.com/etingof/snmpsim-data) | Pre-recorded SNMP walks from real devices | Quick device mocking |
| [snmposter](https://github.com/cluther/snmposter) | Multi-agent from snmpwalk files | Multiple device types |

### Network Behavior Simulation

| Tool | Description | Best For |
|------|-------------|----------|
| [python-flaky-network](https://github.com/adobe/python-flaky-network) | Simulate latency, jitter, packet loss | Network impairment modeling |
| [netsim](https://github.com/stoyanovgeorge/netsim) | Linux tc/netem wrapper for impairments | Realistic network conditions |

---

## Storage Options

### Lightweight/Embedded Time Series

| Tool | Description | Best For |
|------|-------------|----------|
| [TinyFlux](https://github.com/citrusvanilla/tinyflux) | Zero-dependency Python TSDB, CSV storage | **Prototype-friendly**, simple |
| [FlashDB](https://github.com/armink/FlashDB) | Embedded C TSDB for constrained devices | IoT edge |

### Production-Grade (if needed later)

| Tool | Description |
|------|-------------|
| [InfluxDB](https://github.com/influxdata/influxdb) | Popular TSDB, good JS/Python clients |
| [QuestDB](https://github.com/questdb/questdb) | High-performance, SQL interface |
| [TimescaleDB](https://github.com/timescale/timescaledb) | PostgreSQL extension for time series |

### Event Log Storage

| Option | Description |
|--------|-------------|
| SQLite | Simple, embedded, good for event logs |
| [TinyDB](https://github.com/msiemens/tinydb) | Document-oriented, JSON, zero-config |
| Filesystem + JSON | Simplest for prototype |

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  SIMULATOR CONTROLLER                    │
│  - Network profile presets (small, campus, retail)      │
│  - Scenario triggers (WAN failure, firmware update)     │
│  - Model parameter adjustment                           │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              STATISTICAL BEHAVIOR ENGINE                 │
│  - GluonTS/Darts for probabilistic metric generation    │
│  - DE-Sim/Simulus for event scheduling                  │
│  - Correlation engine (events trigger metric changes)   │
└─────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│   METRIC STREAM         │  │   EVENT STREAM          │
│   (WebSocket/SSE)       │  │   (WebSocket/SSE)       │
│                         │  │                         │
│   → TinyFlux (persist)  │  │   → SQLite (persist)    │
└─────────────────────────┘  └─────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              MONITORING APP (Consumer)                   │
│  - Timeseries chart with distribution ribbon            │
│  - Event overlay                                        │
│  - Historical query                                     │
│  - Model adjustment UI                                  │
└─────────────────────────────────────────────────────────┘
```

---

## Recommended Tool Selection

### For Statistical Metric Generation
**Primary:** [Darts](https://github.com/unit8co/darts)
- Probabilistic forecasting with distribution outputs
- Supports conformal prediction for calibrated intervals
- Can train on sample patterns, then generate realistic variations
- Anomaly detection built-in

**Alternative:** [GluonTS](https://github.com/awslabs/gluonts) with Chronos
- Zero-shot forecasting (no training needed)
- Good for generating diverse patterns quickly

### For Event Simulation
**Primary:** [DE-Sim](https://github.com/KarrLab/de_sim) or [Simulus](https://github.com/liuxfiu/simulus)
- Object-oriented Python
- Reproducible scenarios
- Configurable checkpointing

### For Storage
**Metrics:** [TinyFlux](https://github.com/citrusvanilla/tinyflux)
- Perfect for prototype
- No dependencies
- Human-readable CSV

**Events:** SQLite or TinyDB
- Simple, embedded
- Query-friendly

### For Real-Time Streaming
**WebSocket server** in Python (e.g., `websockets` library)
- Push metrics at configurable rate
- Push events as they occur

---

## Network Profile Presets (Draft)

| Profile | Sites | Devices/Site | Clients/Site | Typical Issues |
|---------|-------|--------------|--------------|----------------|
| Small Office | 1 | 5-10 | 20-50 | WiFi congestion, ISP issues |
| Multi-floor | 1 | 30-100 | 200-500 | Roaming, coverage gaps, backhaul |
| Campus | 3-5 | 100-500 | 1000-5000 | Aggregation, WAN, policy conflicts |
| Retail Chain | 50-500 | 5-10 each | 20-50 each | WAN variance, remote management |

---

## Next Steps

1. Define the <10 core metrics and their statistical characteristics
2. Define event information architecture (types, frequencies, correlations)
3. Prototype the behavior engine with Darts + Simulus
4. Set up TinyFlux + SQLite persistence
5. Build WebSocket streaming layer
6. Create simulator controller API/CLI

---

## Sources

### Time Series Generation
- [ydata-synthetic](https://github.com/ydataai/ydata-synthetic)
- [GluonTS](https://github.com/awslabs/gluonts)
- [Darts](https://github.com/unit8co/darts)
- [tsgm](https://github.com/AlexanderVNikitin/tsgm)

### Event Simulation
- [Simulus](https://github.com/liuxfiu/simulus)
- [DE-Sim](https://github.com/KarrLab/de_sim)
- [Eventsim](https://github.com/Interana/eventsim)

### Telemetry
- [cisco-open/test-telemetry-generator](https://github.com/cisco-open/test-telemetry-generator)
- [otelgen](https://github.com/krzko/otelgen)
- [snmpsim](https://github.com/etingof/snmpsim)

### Storage
- [TinyFlux](https://github.com/citrusvanilla/tinyflux)
- [TinyDB](https://github.com/msiemens/tinydb)
- [awesome-time-series-database](https://github.com/xephonhq/awesome-time-series-database)

### Network Simulation
- [python-flaky-network](https://github.com/adobe/python-flaky-network)
- [netsim](https://github.com/stoyanovgeorge/netsim)
