# Phase 1 Implementation Plan

**Status**: Ready to implement  
**Plan File**: See `~/.cursor/plans/phase_1_implementation_90ecf5e2.plan.md` for full details  
**Last Updated**: 2026-02-03

---

## Quick Start for Agents

Read these documents in order before starting implementation:

1. **[architecture.md](architecture.md)** - Overall system design
2. **[decisions.md](decisions.md)** - All ADRs (Architecture Decision Records)
3. **[juttle-viz-implementation-guide.md](juttle-viz-implementation-guide.md)** - D3 patterns, visual design reference
4. **Full plan**: `~/.cursor/plans/phase_1_implementation_90ecf5e2.plan.md`

**Reference source code**: `docs/references/juttle-viz-source/`

---

## Critical Design Decisions

### ADR-001: Stream Format (MOST IMPORTANT)
- **WebSocket stream**: Raw observations ONLY (timestamp, metric, value)
- **NO percentiles in stream**
- **HTTP API**: Returns observations + computed distribution (p5, p25, p50, p75, p95)
- **Distribution computed from historical queries**, not streamed

### ADR-003: Broadcast Model
- All clients receive all messages
- Client-side filtering
- No subscription management

### ADR-009: Dual-Source Hybrid
1. Load historical data via HTTP (includes distributions)
2. Connect WebSocket for raw observations
3. Append live data, auto-scroll in "live mode"

### ADR-010: Prototype Shortcuts
- Skip: auth, tests, error handling, downsampling
- Invest in: data schemas, storage API, chart architecture

---

## Implementation Order

### Backend (Python)

1. **Setup** - venv, requirements.txt (darts, tinyflux, websockets, fastapi, apscheduler)
2. **Metrics Generator** - Darts with seasonality, 7 metrics, raw observations
3. **Event Generator** - Python scheduler, correlation to metrics
4. **Storage** - TinyFlux (metrics), SQLite (events), distribution computation
5. **WebSocket Server** - Broadcast raw observations only
6. **HTTP API** - FastAPI endpoints with Pydantic models, compute distributions

### Frontend (TypeScript + D3.js v7)

7. **Setup** - Vite, TypeScript, D3.js v7
8. **Chart Core** - ChartView, ChartCore, SharedRange, DataTarget (see juttle-viz reference)
9. **Line Generator** - D3 line rendering (reference: `juttle-viz-source/src/lib/generators/line.js`)
10. **Distribution Ribbon** - NEW feature, gradient field from percentiles
11. **Event Markers** - Vertical lines + icons (reference: `juttle-viz-source/src/lib/generators/event-markers.js`)
12. **API Client** - HTTP + WebSocket client
13. **Live Integration** - Wire historical + live data seamlessly
14. **Minimal UI** - Metric selector, time range, live mode toggle

---

## File Structure

```
backend/
├── simulator/
│   ├── metrics_generator.py      # Darts time series
│   ├── event_generator.py        # Event scheduling
│   ├── correlation.py            # Event → metric correlation
│   └── bootstrap.py              # Historical data generation
├── storage/
│   ├── metrics_store.py          # TinyFlux wrapper
│   └── events_store.py           # SQLite wrapper
├── server/
│   ├── websocket_server.py       # Broadcast server
│   ├── http_api.py               # FastAPI endpoints
│   └── models.py                 # Pydantic schemas
├── requirements.txt
└── main.py

frontend/
├── src/
│   ├── chart/
│   │   ├── ChartView.ts
│   │   ├── ChartCore.ts
│   │   ├── SharedRange.ts
│   │   ├── DataTarget.ts
│   │   ├── generators/
│   │   │   ├── Generator.ts      # Base interface
│   │   │   ├── Line.ts
│   │   │   ├── DistributionRibbon.ts
│   │   │   └── EventMarkers.ts
│   │   └── types.ts
│   ├── api/
│   │   └── client.ts             # HTTP + WebSocket
│   ├── main.ts
│   └── style.css
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Data Formats

### WebSocket Message (Raw Observations Only)

```javascript
// Metric
{
  "type": "metric",
  "timestamp": 1234567890,
  "metric": "time_to_connect",
  "value": 45
}

// Event
{
  "type": "event",
  "timestamp": 1234567890,
  "event_type": "device_restart",
  "severity": "warning",
  "entity": "AP-Floor3-02",
  "message": "Access point rebooted",
  "metadata": {...}
}
```

### HTTP Response (With Computed Distribution)

```javascript
GET /api/metrics/time_to_connect?start=1234567890&end=1234571490

{
  "metric": "time_to_connect",
  "start": 1234567890,
  "end": 1234571490,
  "observations": [
    {"timestamp": 1234567890, "value": 45},
    {"timestamp": 1234567900, "value": 42},
    ...
  ],
  "distribution": {
    "p5": 20,
    "p25": 35,
    "p50": 42,
    "p75": 55,
    "p95": 85,
    "mean": 44.3,
    "stddev": 12.1
  }
}
```

---

## Visual Design Reference

**Color Palette** (from juttle-viz):
```
#D87118 - orange
#4E8DB8 - blue
#FED66F - yellow
#79E0CB - aqua
#A4B946 - green
#EB91C0 - pink
#666E4C - olive
#8A406D - purple
#CC2200 - red
```

**Key Styles**:
- Lines: stroke-width 1px, no fill
- Axes: stroke-width 2px, crisp edges
- Event markers: gray medium (#999), blue on hover (#7EC7FF)
- Hover circles: 4.5px radius, yellow stroke

**See**: `docs/juttle-viz-implementation-guide.md` for complete styling reference

---

## Checkpoints

### Checkpoint 1: Data Generation
- Generate 7 metrics with seasonality ✓
- Generate correlated events ✓
- Test: Print data, verify realism

### Checkpoint 2: Storage
- TinyFlux stores raw metrics ✓
- SQLite stores events ✓
- Distribution computation works ✓
- Test: Write → query → verify

### Checkpoint 3: Streaming
- WebSocket broadcasts raw observations ✓
- HTTP API serves historical + distributions ✓
- Test: Simple HTML page connects

### Checkpoint 4: Basic Chart
- ChartView architecture ✓
- Line generator renders ✓
- Test: Display hardcoded data

### Checkpoint 5: Historical + Live
- Query historical on init ✓
- WebSocket connection ✓
- Append live smoothly ✓
- Test: Seamless timeline

### Checkpoint 6: Distribution Ribbon
- Gradient field from percentiles ✓
- Test: Visualize variance

### Checkpoint 7: Event Markers
- Query events for range ✓
- Overlay on chart ✓
- Filter by type ✓
- Test: Correlation visible

### Checkpoint 8: Complete UI
- All controls work ✓
- Test: End-to-end demo

---

## Tech Stack

| Layer | Technology | Reason |
|-------|------------|---------|
| Metrics generation | Darts | Probabilistic, seasonality |
| Events generation | Python apscheduler | Simple, sufficient |
| Metrics storage | TinyFlux | Zero setup, CSV-backed |
| Events storage | SQLite | Embedded, queryable |
| Streaming | Python websockets | Broadcast model |
| HTTP API | FastAPI | Type-safe, async, auto-docs |
| Frontend build | Vite | Fast dev, TypeScript |
| Rendering | D3.js v7 | Flexibility for custom viz |
| Language | TypeScript | Type safety |

---

## Success Criteria

At end of Phase 1:

✅ Simulator generates realistic metrics with seasonality  
✅ Event bus streams raw observations (no percentiles)  
✅ Storage persists everything, handles range queries  
✅ HTTP API computes distributions from historical data  
✅ Chart displays historical data correctly  
✅ Chart appends live data and scrolls seamlessly  
✅ Event markers correlate with metric changes  
✅ Distribution ribbon shows variance over time  

**This is the foundation. Application features build on top.**

---

## Common Pitfalls to Avoid

1. ❌ **Don't put percentiles in WebSocket stream** (ADR-001)
2. ❌ **Don't implement pub/sub** - use broadcast (ADR-003)
3. ❌ **Don't skip juttle-viz reference** - reuse proven patterns
4. ❌ **Don't use jQuery/Backbone** - modernize with vanilla JS
5. ❌ **Don't add auth/tests yet** - prototype shortcuts (ADR-010)

---

## Next Steps After Phase 1

- Phase 2: Multi-metric dashboard (7 charts, synchronized)
- Phase 3: Alert system (thresholds, history)
- Phase 4: AI action tracking (reasoning display)
- Phase 5: What-if scenarios (predictive modeling)
