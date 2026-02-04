# System Architecture

Network monitoring infrastructure with simulated event stream, storage, and real-time visualization.

## Overview

```
┌─────────────────┐
│   Simulator     │  Generate 7 metrics + events
│   (Darts)       │  with realistic seasonality
└────────┬────────┘
         │
         v
┌─────────────────┐
│   Event Bus     │  WebSocket broadcast
│  (websockets)   │  Real-time metric & event stream
└────┬────────────┘
     │
     ├─────────────────────────┐
     │                         │
     v                         v
┌────────────┐        ┌──────────────┐
│  Storage   │        │   Clients    │
│            │        │  (browsers)  │
│ TinyFlux   │<───────│              │
│ SQLite     │  query │   Chart      │
└────────────┘        └──────────────┘
```

## Data Flow

### 1. Simulation Layer

**Purpose**: Generate realistic network telemetry

**Components**:

- Metrics generator (Darts) - 7 network health metrics with seasonality
- Event generator (Python scheduler) - Device/config/AI events
- Correlation engine - Link events to metric changes

**Output**: Stream of observations + discrete events

### 2. Event Bus

**Purpose**: Real-time distribution to connected clients

**Protocol**: WebSocket (broadcast model)

- All connected clients receive all messages
- Client-side filtering by metric/event type
- Simple server implementation (no subscription management)

**Message Types**:

```javascript
// Metric observation
{
    "type": "metric",
    "timestamp": 1234567890,
    "metric": "time_to_connect",
    "value": 45
}

// Event occurrence
{
    "type": "event",
    "timestamp": 1234567890,
    "event_type": "device_restart",
    "severity": "warning",        // nullable
    "entity": "AP-Floor3-02",
    "message": "Access point rebooted",
    "metadata": {...}
}
```

**Trade-off**: Broadcast vs pub/sub

- Chose broadcast for prototype simplicity
- 7 metrics × 10Hz = 70 msg/sec (negligible bandwidth)
- Can refactor to pub/sub later if needed

### 3. Storage Layer

**Purpose**: Persistent history for analysis

**Metrics** - TinyFlux (time-series database)

- Stores all metric observations
- Range queries: `get_metrics(metric, start, end)`
- Lightweight, CSV-backed, zero dependencies

**Events** - SQLite

- Stores all events with metadata
- Indexed by timestamp, type
- Supports filtering and correlation queries

**Distribution Computation**:

- Distributions (percentiles) computed from historical queries
- NOT stored in real-time stream
- Chart queries history, computes p5/p25/p50/p75/p95 for visible range

### 4. Query API

**Purpose**: Historical data access for clients

**Endpoints**:

```
GET /api/metrics/{metric}?start={ts}&end={ts}
→ Metric observations in range

GET /api/events?start={ts}&end={ts}&type={type}
→ Events in range, optionally filtered

GET /api/metrics/distribution/{metric}?start={ts}&end={ts}
→ Computed percentiles for range
```

**Technology**: FastAPI (Python)

- Type-safe, auto-generated OpenAPI docs
- Fast async I/O

### 5. Visualization Layer

**Purpose**: Timeseries chart with real-time + historical display

**Architecture**: See [chart-design.md](chart-design.md)

**Key Feature**: Seamless historical + live hybrid

1. Page load → query historical data
2. Render past data
3. Connect WebSocket → append live data
4. Auto-scroll in "live mode" (past on left → now on right)

**Components**:

- ChartView - Orchestration
- ChartCore - Scales, axes, rendering
- Generators - Line, DistributionRibbon, EventMarkers
- DataTarget - Per-series buffering

## Technology Stack

| Layer              | Technology          | Rationale                                 |
| ------------------ | ------------------- | ----------------------------------------- |
| Metrics generation | Darts               | Probabilistic, seasonality, distributions |
| Events generation  | Python scheduler    | Simple, sufficient for prototype          |
| Metrics storage    | TinyFlux            | Lightweight, no setup, CSV-backed         |
| Events storage     | SQLite              | Embedded, queryable, standard             |
| Event bus          | Python `websockets` | Low latency, standard protocol            |
| HTTP API           | FastAPI             | Fast, type-safe, OpenAPI docs             |
| Frontend build     | Vite                | Fast dev server, TypeScript, HMR          |
| Rendering          | D3.js v7            | Flexible, proven, large community         |
| Language           | TypeScript          | Type safety for complex chart API         |

## Design Decisions

### Why broadcast instead of pub/sub?

- **Simplicity**: No subscription management in server
- **Scale**: 70 msg/sec is negligible for WebSocket
- **Extensibility**: Client API looks like subscription, can swap implementation
- **Prototype-appropriate**: Real systems use pub/sub, but overhead not justified here

### Why compute distributions from history, not stream?

- **Separation of concerns**: Stream carries raw observations
- **Flexibility**: Different time ranges → different distributions
- **Accuracy**: Statistical computation on complete dataset, not streaming approximation
- **Realistic**: Production systems often compute distributions in query layer

### Why TypeScript + Vite?

- **Type safety**: Chart API is complex (SharedRange, DataTarget, configuration schema)
- **Modules**: D3 works best as ES modules
- **Developer experience**: Hot reload for visualization iteration
- **Minimal cost**: Setup takes 5 minutes, saves debugging time

### Why Darts over discrete event simulator?

- **Sufficient**: Probabilistic time series + Python scheduler covers use case
- **Simpler**: No learning curve for complex event simulation framework
- **Extensible**: Can add DE-Sim/Simulus later if we need complex scenarios
- **Focused**: Metrics are primary, events are secondary

## Deployment (Prototype)

Single machine, local development:

```bash
# Terminal 1: Backend
cd backend
python main.py
# → WebSocket on :8000, HTTP API on :8001

# Terminal 2: Frontend
cd frontend
npm run dev
# → Vite dev server on :5173
```

Browser connects to:

- WebSocket: `ws://localhost:8000`
- HTTP API: `http://localhost:8001`

## Future Extensions

When moving beyond prototype:

**Multi-metric dashboard**: Grid of 7 charts, synchronized time range
**Alert system**: User-defined thresholds, alert history
**AI action tracking**: Highlight AI events with reasoning
**What-if scenarios**: Adjust parameters, show predictions
**Pub/sub**: Subscription-based streaming for scale
**Authentication**: Secure WebSocket + API
**Persistence**: Move to production TSDB (InfluxDB, QuestDB)
