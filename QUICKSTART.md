# Quick Start Guide

## Prerequisites

- Python 3.11+
- Node.js 18+
- Terminal access

## Setup & Run (5 minutes)

### 1. Backend Setup

```bash
cd backend

# Create conda environment
conda create -n monitoring-app python=3.11

# Activate it
conda activate monitoring-app

# Install dependencies
pip install -r requirements.txt
```

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install
```

### 3. Run the Application

**Terminal 1 - Backend:**
```bash
cd backend
conda activate monitoring-app
python main.py
```

You should see:
- WebSocket server on `ws://localhost:8000`
- HTTP API on `http://localhost:8001`
- FastAPI docs at `http://localhost:8001/docs`

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

You should see:
- Vite dev server on `http://localhost:5173`

### 4. Open Browser

Navigate to `http://localhost:5173`

You should see:
- Network monitoring dashboard
- Time series chart with orange line
- Blue distribution ribbon showing variance
- Event markers as vertical lines
- Live updates every 10 seconds
- "Connected" status indicator (green)

## What You'll See

### The Chart

- **Orange line**: Current metric values (time_to_connect by default)
- **Blue gradient ribbon**: Statistical distribution (p5-p95 range)
  - Darker center = typical values (p25-p75)
  - Lighter edges = rare values (< p5, > p95)
- **Gray vertical lines**: Events (device restarts, config changes, etc.)
  - Hover to see event details

### The Controls

- **Metric dropdown**: Switch between 7 network metrics
- **Time Range dropdown**: Last 1hr, 3hr, 6hr, 12hr, or 24hr
- **Live Mode checkbox**: Auto-scroll timeline as new data arrives
- **Show Events checkbox**: Toggle event markers visibility

### Live Data

- New observations arrive every 10 seconds (all 7 metrics)
- Random events occur every ~5 minutes
- Timeline auto-scrolls in Live Mode
- Distribution ribbon shows overall variance for the visible time range

## Testing the System

### 1. Switch Metrics

Select different metrics from the dropdown:
- **Time to Connect** - Connection latency (ms)
- **Throughput** - Data transfer rate (Mbps)
- **Coverage** - Signal strength (dBm)
- **Capacity** - Bandwidth utilization (%)
- **Roaming** - Handoff latency (ms)
- **Successful Connects** - Success rate (%)
- **AP Health** - Composite health score (0-100)

Each metric has realistic seasonality patterns (daily/weekly cycles).

### 2. Explore Time Ranges

- Change time range to see different history windows
- Notice how the distribution ribbon adapts to different variance levels
- Zoom in/out to see more/less granularity

### 3. Toggle Features

- Uncheck "Show Events" to hide event markers
- Uncheck "Live Mode" to freeze the timeline
- Re-enable Live Mode to resume auto-scrolling

### 4. Hover on Events

- Hover over gray vertical lines to see event details
- Event types: device_restart, firmware_update, config_change, ai_action, device_crash
- Notice how events often correlate with metric changes

## Architecture Highlights

### Backend (Python)

- **Darts**: Generates realistic time series with seasonality
- **TinyFlux**: Lightweight CSV-backed metrics storage
- **SQLite**: Event storage with metadata
- **FastAPI**: Type-safe HTTP API with auto-docs
- **WebSockets**: Real-time broadcast to all clients

### Frontend (TypeScript + D3.js)

- **Vite**: Fast dev server with HMR
- **D3.js v7**: Custom visualization with full control
- **ChartView**: Modular architecture (inspired by juttle-viz)
  - ChartCore: Scales, axes, SVG structure
  - Generators: Pluggable renderers (Line, DistributionRibbon, EventMarkers)
  - DataTarget: Per-series data buffering
  - SharedRange: Synchronized time range across components

### Key Design Decisions (ADRs)

- **ADR-001**: Stream carries raw observations only, distributions computed from history
- **ADR-003**: Broadcast model (all clients get all data)
- **ADR-009**: Hybrid approach (historical HTTP load + live WebSocket append)
- **ADR-010**: Prototype shortcuts (no auth, tests, or error handling for now)

## Troubleshooting

### Backend won't start

**Error**: `ModuleNotFoundError: No module named 'darts'`

**Fix**: Activate conda environment and install dependencies:
```bash
cd backend
conda activate monitoring-app
pip install -r requirements.txt
```

### Frontend won't start

**Error**: `Cannot find module 'd3'`

**Fix**: Install dependencies:
```bash
cd frontend
npm install
```

### WebSocket won't connect

**Error**: Connection status shows "Disconnected"

**Fix**: 
1. Check backend is running (`python main.py`)
2. Check console for WebSocket errors
3. Verify ports 8000 and 8001 are not in use

### No data showing

**Fix**:
1. Check browser console for errors
2. Verify backend is generating data (check backend terminal output)
3. Try refreshing the page
4. Check that historical data was bootstrapped (should happen on first run)

## Next Steps

After confirming Phase 1 works:

- **Phase 2**: Multi-metric dashboard (7 charts synchronized)
- **Phase 3**: Alert system (thresholds, flap detection)
- **Phase 4**: AI action tracking (highlight reasoning)
- **Phase 5**: What-if scenarios (predictive modeling)

## API Documentation

### HTTP API

Visit `http://localhost:8001/docs` for interactive Swagger documentation.

Key endpoints:
- `GET /api/metrics` - List available metrics
- `GET /api/metrics/{metric}?start={ts}&end={ts}` - Query metric with distribution
- `GET /api/events?start={ts}&end={ts}` - Query events

### WebSocket

Connect to `ws://localhost:8000`

Message format:
```javascript
// Metric observation
{"type": "metric", "timestamp": 1234567890, "metric": "throughput", "value": 245}

// Event
{"type": "event", "timestamp": 1234567890, "event_type": "device_restart", ...}
```

## Performance Notes

- Backend generates 7 metrics × 10 sec interval = 70 msg/sec WebSocket
- Frontend buffers all data (no downsampling in prototype)
- Suitable for demos up to ~1 hour of data
- For longer runs, consider clearing data periodically or implementing downsampling

## Development

### Hot Reload

Both frontend and backend support hot reload:
- Frontend: Vite HMR (instant updates)
- Backend: Restart `python main.py` to apply changes

### Debugging

- Frontend: Browser DevTools console
- Backend: Check terminal output for logs
- API: Use Swagger UI at `http://localhost:8001/docs` to test endpoints

### Code Structure

See `docs/architecture.md` for detailed system design.

Key files:
- `backend/main.py` - Application entry point
- `backend/simulator/metrics_generator.py` - Time series generation
- `backend/storage/metrics_store.py` - TinyFlux wrapper
- `frontend/src/main.ts` - Frontend entry point
- `frontend/src/chart/ChartView.ts` - Chart orchestrator
- `frontend/src/api/client.ts` - API client

## Support

For questions or issues:
1. Check `docs/` folder for design documentation
2. Review ADRs in `docs/decisions.md` for rationale
3. See implementation patterns in `docs/implementation-plan.md`

Enjoy exploring the network monitoring prototype! 🎉
