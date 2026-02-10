# Network Monitoring Prototype

Real-time network monitoring visualization with simulated event streams and statistical anomaly detection.

## Overview

This prototype demonstrates a self-healing network monitoring system with:

- **7 network health metrics** (Time to Connect, Throughput, Coverage, Capacity, Roaming, Successful Connects, AP Health)
- **Event correlation** (device restarts, config changes, AI actions)
- **Distribution visualization** (percentile ribbons showing variance over time)
- **Real-time + historical** (seamless past → present timeline)
- **Continuous operation** (maintains 30-day rolling window for shared demo access)

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
| [juttle-viz-implementation-guide.md](docs/juttle-viz-implementation-guide.md) | D3 patterns, visual design, code reference from juttle-viz |

**Reference Materials**:
- `docs/references/juttle-viz-source/` - Complete juttle-viz source code for reference
- `docs/references/juttle-viz.md` - Quick reference guide for juttle-viz API

## Quick Start

### Backend

```bash
cd backend
conda create -n monitoring-app python=3.11
conda activate monitoring-app
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

## Continuous Operation (Production Deployment)

For running the app continuously under pm2 or similar process managers:

### Configuration

The backend supports continuous operation mode that preserves data across restarts:

**Environment Variables**:
- `SKIP_BOOTSTRAP=true` - Keeps existing data instead of regenerating on restart
- `NETWORK_PROFILE` - Network simulation profile (enterprise/hospital/campus)

**pm2 Configuration Example**:

```javascript
{
  name: 'monitoring-app-backend',
  cwd: '/opt/monitoring-app/backend',
  script: '/opt/monitoring-app/backend/venv/bin/python',
  args: 'main.py',
  env: {
    PYTHONUNBUFFERED: '1',
    SKIP_BOOTSTRAP: 'true'        // Preserve data across restarts
  },
  cron_restart: '0 3 * * 0'       // Weekly restart (Sunday 3am)
}
```

### How It Works

**First Run** (no existing data):
- Generates 30 days of synthetic historical data
- Starts live metric generation (every 10s)
- Begins event simulation

**Subsequent Restarts** (with `SKIP_BOOTSTRAP=true`):
- Preserves all accumulated data
- Resumes live generation from current time
- Shows data age in startup logs

**Automatic Maintenance**:
- Daily cleanup at 3am (deletes data older than 30 days)
- Weekly pm2 restart (refreshes 30-day history window)
- Storage bounded to ~30 days, ~40-60MB

### Fresh Start (Manual Reset)

To clear all data and regenerate from scratch:

```bash
# Stop the backend
pm2 stop monitoring-app-backend

# Delete database files
rm /opt/monitoring-app/backend/data/metrics.csv
rm /opt/monitoring-app/backend/data/events.db

# Restart (will regenerate fresh data)
pm2 start monitoring-app-backend
```

### Storage Management

**Database Files**:
- `backend/data/metrics.csv` - Time-series metrics (TinyFlux)
- `backend/data/events.db` - Discrete events (SQLite)

**Growth Pattern**:
- ~10-15MB per week with 10s resolution
- Bounded to 30 days by daily cleanup
- Weekly restart provides fresh synthetic history

**Tips for Long-Running Deployments**:
- Monitor disk space (50-100MB buffer recommended)
- Check logs for cleanup execution (`pm2 logs`)
- Adjust `cron_restart` frequency based on demo needs

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

**Current Phase**: Phase 1 Complete! ✅

**Implemented**:

- [x] Documentation structure
- [x] Backend simulator (metrics + events)
- [x] Storage layer (TinyFlux + SQLite)
- [x] WebSocket event bus
- [x] HTTP query API
- [x] Frontend chart architecture
- [x] Distribution ribbon renderer
- [x] Event markers overlay
- [x] Minimal UI

All Phase 1 features are complete and ready for demo!

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
