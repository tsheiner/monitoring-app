# Network Monitoring Prototype

Real-time network monitoring visualization with simulated event streams and statistical anomaly detection.

## Overview

This prototype demonstrates a self-healing network monitoring system with:

- **7 network health metrics** (Time to Connect, Throughput, Coverage, Capacity, Roaming, Successful Connects, AP Health)
- **Event correlation** (device restarts, config changes, AI actions)
- **Distribution visualization** (percentile ribbons showing variance over time)
- **Real-time + historical** (seamless past → present timeline)

Built for executive demos and technical validation, not production deployment.

## Architecture

```
┌─────────────┐
│  Simulator  │  Generates realistic metrics + events
│   (Darts)   │  with seasonality and correlation
└──────┬──────┘
       │
       v
┌─────────────┐
│  Event Bus  │  WebSocket broadcast
│ (websockets)│  Real-time streaming to clients
└──┬─────────┘
   │
   ├─────────────────────┐
   │                     │
   v                     v
┌──────────┐      ┌─────────────┐
│ Storage  │      │   Browser   │
│ TinyFlux │<─────│   Chart     │
│ SQLite   │ query│   (D3.js)   │
└──────────┘      └─────────────┘
```

See [docs/architecture.md](docs/architecture.md) for details.

## Documentation

| Document                                    | Description                             |
| ------------------------------------------- | --------------------------------------- |
| [architecture.md](docs/architecture.md)     | System design, data flow, tech stack    |
| [metrics-schema.md](docs/metrics-schema.md) | 7 network metrics, formats, seasonality |
| [event-schema.md](docs/event-schema.md)     | Event types, correlation, storage       |
| [decisions.md](docs/decisions.md)           | Architecture Decision Records (ADRs)    |
| [chart-design.md](docs/chart-design.md)     | Timeseries chart architecture           |

## Quick Start

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
python main.py
```

WebSocket server: `ws://localhost:8000`  
HTTP API: `http://localhost:8001`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open browser to `http://localhost:5173`

## Tech Stack

**Backend**:

- Python 3.11+
- Darts (time series generation)
- TinyFlux (metrics storage)
- SQLite (events storage)
- FastAPI (HTTP API)
- websockets (real-time streaming)

**Frontend**:

- TypeScript
- Vite (build tool)
- D3.js v7 (visualization)

## Project Structure

```
monitoring-app/
├── docs/                    # Architecture & design docs
│   ├── architecture.md
│   ├── metrics-schema.md
│   ├── event-schema.md
│   ├── decisions.md
│   ├── chart-design.md
│   └── references/          # Background research
├── backend/
│   ├── simulator/           # Darts metrics + event generation
│   ├── storage/             # TinyFlux + SQLite wrappers
│   ├── server/              # WebSocket + FastAPI
│   └── main.py
├── frontend/
│   ├── src/
│   │   ├── chart/           # Timeseries chart library
│   │   │   ├── ChartView.ts
│   │   │   ├── ChartCore.ts
│   │   │   └── generators/
│   │   │       ├── Line.ts
│   │   │       ├── DistributionRibbon.ts
│   │   │       └── EventMarkers.ts
│   │   └── main.ts
│   └── index.html
├── .claude/                 # Claude-specific instructions
├── .cursorrules             # Cursor IDE rules
└── README.md
```

## Key Features

### Distribution Ribbon Visualization

Shows statistical variance over time as a gradient field:

- Dark center = typical values (p25-p75)
- Faint edges = rare events (< p5, > p95)
- Visually obvious anomalies outside normal range

### Event Correlation

Discrete events (device restarts, config changes, AI actions) appear as markers on the timeline, correlated with metric changes.

### Real-Time + Historical Hybrid

- Initial load: Query last N hours of history
- Seamless transition: Live data appends to right edge
- Live mode: Time window auto-scrolls forward
- Historical mode: Zoom/pan to explore past

### 7 Network Metrics

Based on Juniper Mist industry standards:

1. **Time to Connect** (ms) - Client association latency
2. **Throughput** (Mbps) - Data transfer rate
3. **Coverage** (dBm) - Signal strength
4. **Capacity** (%) - Bandwidth utilization
5. **Roaming** (ms) - Handoff latency
6. **Successful Connects** (%) - Connection success rate
7. **AP Health** (0-100) - Access point health score

## Development Status

**Current Phase**: Data infrastructure (Phase 1)

**Implemented**:

- [x] Documentation structure
- [ ] Backend simulator (metrics + events)
- [ ] Storage layer (TinyFlux + SQLite)
- [ ] WebSocket event bus
- [ ] HTTP query API
- [ ] Frontend chart architecture
- [ ] Distribution ribbon renderer
- [ ] Event markers overlay
- [ ] Minimal UI

See [implementation plan](/.cursor/plans/) for detailed checkpoints.

## Design Philosophy

This prototype balances:

- **Realism**: Looks/feels like a production system
- **Speed**: Prototype shortcuts where appropriate
- **Extensibility**: Solid foundation for future features

**We invest in**:

- Data schemas (stable, well-documented)
- Storage API (clean abstraction)
- Chart architecture (extensible generators)

**We skip** (for now):

- Authentication, authorization
- Production error handling
- Automated tests
- Deployment tooling

See [docs/decisions.md](docs/decisions.md) for rationale on all design choices.

## Future Extensions

After Phase 1 infrastructure is complete:

- **Phase 2**: Multi-metric dashboard (7 charts, synchronized time)
- **Phase 3**: Alert system (thresholds, flap detection)
- **Phase 4**: AI action tracking (highlight reasoning)
- **Phase 5**: What-if scenarios (predictive modeling)

## Contributing

This is a prototype for executive demos. Focus on:

1. Read `docs/` folder before making changes
2. Follow patterns in `docs/chart-design.md`
3. Document decisions in `docs/decisions.md`
4. Keep it simple - prototype, not production

## License

[To be determined]

## Contact

Tim Sheiner - [contact info]
