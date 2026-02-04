# Architecture Decision Record

Key design decisions for the network monitoring prototype.

---

## ADR-001: Metric Stream Format

**Date**: 2026-02-03

**Context**: Should metric observations in the real-time stream include distribution (percentile) data, or just raw values?

**Decision**: Stream carries **raw observations only**. Distribution computed from historical queries.

**Rationale**:

- Separation of concerns: Stream = transport, not analysis
- Flexibility: Different time windows → different distributions
- Accuracy: Compute distributions on complete dataset, not streaming approximation
- Simpler protocol: Fewer fields in real-time messages
- Realistic: Production systems compute distributions in query/analytics layer

**Consequences**:

- ✅ Cleaner data model
- ✅ Chart component computes distributions from buffered history
- ❌ Initial load requires historical query before live stream
- ❌ Distribution updates lag (recomputed on time range change)

**Format**:

```javascript
// Stream: Raw observation
{"type": "metric", "timestamp": 1234567890, "metric": "throughput", "value": 245}

// Query response: Observations + distribution
{
  "observations": [...],
  "distribution": {"p5": 100, "p50": 245, "p95": 500}
}
```

---

## ADR-002: Event Severity Field

**Date**: 2026-02-03

**Context**: Should events have a severity field? Is severity too subjective/interpretive for raw event storage?

**Decision**: Include **optional severity field** in raw event schema.

**Rationale**:

- Source systems often emit severity (syslog levels, SNMP traps)
- Enables efficient filtering ("show critical events only")
- Make it **nullable**: Not all events have inherent severity (e.g., routine config changes)
- Interpretation layer can still add separate annotations/judgments

**Consequences**:

- ✅ Efficient querying by severity (indexed in SQLite)
- ✅ Captures source system's assessment
- ✅ Nullable supports events without severity
- ❌ Some mixing of data and interpretation
- ⚠️ Future: May add separate "interpreted_events" table for AI/human annotations

**Schema**:

```javascript
{
  "severity": "warning" | "info" | "critical" | null
}
```

---

## ADR-003: WebSocket Broadcast vs Pub/Sub

**Date**: 2026-02-03

**Context**: Should clients subscribe to specific metrics, or receive all metrics via broadcast?

**Decision**: **Broadcast model** - all clients receive all messages, filter client-side.

**Rationale**:

- **Simplicity**: No subscription management in server
- **Scale**: 7 metrics × 10Hz = 70 msg/sec is negligible for WebSocket
- **Prototype-appropriate**: Subscription overhead not justified
- **Extensibility**: Client API can look like subscription, swap implementation later

**Consequences**:

- ✅ Simpler server implementation
- ✅ No subscribe/unsubscribe protocol overhead
- ✅ Fewer round trips
- ❌ Wastes bandwidth (client receives unused metrics)
- ❌ Doesn't scale to 100+ metrics (but we have 7)
- ⚠️ Future: Can migrate to pub/sub if scale demands it

**Client API** (looks like subscription, even though broadcast):

```typescript
chart.subscribe("throughput"); // Internally filters broadcast
```

---

## ADR-004: TypeScript + Vite vs Plain JavaScript

**Date**: 2026-02-03

**Context**: Should frontend use TypeScript with Vite bundler, or plain JavaScript with no build step?

**Decision**: **TypeScript + Vite**

**Rationale**:

- **Type safety**: Chart API is complex (SharedRange, DataTarget, generator configuration). Types catch errors at dev time.
- **D3 modules**: D3.js works best as ES modules, awkward with globals
- **Hot reload**: Visualization iteration benefits from instant feedback
- **Low cost**: Vite setup takes 5 minutes, zero config
- **Developer experience**: Saves debugging time on data contract mismatches

**Consequences**:

- ✅ Type safety for complex chart configuration
- ✅ Better IDE autocomplete/intellisense
- ✅ Instant hot reload for D3 tweaking
- ❌ Adds build step (npm run dev, npm run build)
- ❌ Slightly more complex setup than `<script src="d3.js">`
- ⚠️ Trade-off justified: DX improvement > setup cost

---

## ADR-005: Darts vs Discrete Event Simulator

**Date**: 2026-02-03

**Context**: For generating realistic network behavior, should we use Darts (probabilistic time series) or a discrete event simulator (DE-Sim, Simulus)?

**Decision**: **Darts for metrics, Python scheduler for events**. Skip discrete event simulator for prototype.

**Rationale**:

- **Sufficient**: Darts handles metrics (primary data), Python scheduler handles events (secondary)
- **Simpler**: No learning curve for event simulation frameworks
- **Focused**: Metrics drive the visualization, events are overlay
- **Extensible**: Can add DE-Sim later if we need complex scenarios (cascading failures, multi-step sequences)

**Consequences**:

- ✅ Faster prototype development
- ✅ Fewer dependencies
- ✅ Darts provides seasonality, distributions, anomalies
- ❌ Limited event complexity (no multi-stage scenarios)
- ⚠️ Future: Add discrete event sim if AI action sequences get complex

---

## ADR-006: TinyFlux + SQLite vs Production TSDB

**Date**: 2026-02-03

**Context**: For storage, use lightweight embedded databases or production-grade time-series DB (InfluxDB, QuestDB)?

**Decision**: **TinyFlux (metrics) + SQLite (events)** for prototype.

**Rationale**:

- **Zero setup**: No Docker, no install, just Python imports
- **Sufficient scale**: Prototype runs for minutes/hours, not days/months
- **Human-readable**: TinyFlux uses CSV, easy to inspect
- **Extensible storage layer**: API wrapper means we can swap backend later

**Consequences**:

- ✅ Instant start, no infrastructure setup
- ✅ Simple debugging (inspect CSV files)
- ✅ Portable (committed to repo if needed)
- ❌ Limited scale (not for production)
- ❌ No clustering, replication, advanced queries
- ⚠️ Future: Migrate to InfluxDB/QuestDB if prototype becomes production

---

## ADR-007: FastAPI vs Flask for HTTP API

**Date**: 2026-02-03

**Context**: Which Python web framework for historical data queries?

**Decision**: **FastAPI**

**Rationale**:

- **Type safety**: Pydantic models match our data schemas
- **Performance**: Async I/O for concurrent queries
- **Auto-docs**: OpenAPI/Swagger UI generated automatically
- **Modern**: Better DX than Flask for new projects

**Consequences**:

- ✅ Type-safe request/response models
- ✅ Auto-generated API documentation
- ✅ Fast async query handling
- ❌ Slightly more opinionated than Flask
- ⚠️ Minimal downside: Both are equally simple for our use case

---

## ADR-008: D3.js vs Chart Library (Chart.js, Recharts)

**Date**: 2026-02-03

**Context**: For rendering timeseries, use D3.js (low-level) or higher-level chart library?

**Decision**: **D3.js v7**

**Rationale**:

- **Custom visualization**: Distribution ribbon is novel, not in standard libraries
- **Flexibility**: Full control over rendering (gradient fields, event markers)
- **Architecture fit**: Follows juttle-viz patterns (generators, scales, data binding)
- **Learning value**: Understanding D3 helps with any viz work

**Consequences**:

- ✅ Complete flexibility for custom generators
- ✅ Follows proven juttle-viz architecture
- ✅ Community support, extensive examples
- ❌ Steeper learning curve than Chart.js
- ❌ More code for standard features (axes, tooltips)
- ⚠️ Trade-off justified: Custom needs > convenience library

---

## ADR-009: Real-Time + Historical Hybrid Approach

**Date**: 2026-02-03

**Context**: How should chart display both historical data and live stream seamlessly?

**Decision**: **Dual-source hybrid**: Initial historical query + WebSocket append.

**Approach**:

1. Page load → Query last N hours of historical data
2. Render complete timeline
3. Connect WebSocket → Append new observations to right edge
4. "Live mode" → Time window slides forward automatically
5. User can zoom to historical period (disables live scrolling)

**Rationale**:

- **Seamless UX**: No gap between historical and live
- **Realistic**: Production systems work this way
- **Flexible**: User can explore history or watch live
- **Simple protocol**: No complex backfill logic in stream

**Consequences**:

- ✅ Natural "past on left, present on right" timeline
- ✅ No visible transition between historical and live
- ✅ User controls time range and live mode
- ❌ Requires two data sources (HTTP + WebSocket)
- ❌ Initial load waits for historical query
- ⚠️ Worth it: This is how monitoring works in practice

---

## ADR-010: Prototype Shortcuts (What We Skip)

**Date**: 2026-02-03

**Context**: What production features can we skip to accelerate prototype?

**Decision**: Cut these corners:

**Skip**:

- ❌ Authentication/authorization
- ❌ Error handling beyond basic try/catch
- ❌ Automated tests (manual validation only)
- ❌ Downsampling (limit query ranges instead)
- ❌ Discrete event simulator (Python scheduler sufficient)
- ❌ Pub/sub (broadcast adequate)
- ❌ Production deployment (local dev only)

**Invest in** (solid foundation):

- ✅ Data schemas (won't change)
- ✅ Storage layer with good API
- ✅ WebSocket protocol
- ✅ Chart architecture (ChartView/ChartCore)
- ✅ TypeScript types for chart API

**Rationale**:

- Prototype needs to demonstrate capability, not handle edge cases
- Foundation must be extensible (refactoring viz is painful)
- We can add production features later without rearchitecting

**Consequences**:

- ✅ Faster development
- ✅ Focus on core functionality
- ✅ Solid foundation for extension
- ⚠️ Not production-ready (by design)

---

## Decision Log Summary

| ADR | Decision                    | Rationale                          |
| --- | --------------------------- | ---------------------------------- |
| 001 | Raw observations in stream  | Separation of concerns             |
| 002 | Optional severity in events | Source systems provide it          |
| 003 | Broadcast vs pub/sub        | Simplicity, sufficient scale       |
| 004 | TypeScript + Vite           | Type safety for complex API        |
| 005 | Darts + scheduler           | Sufficient, simpler than DE-Sim    |
| 006 | TinyFlux + SQLite           | Zero setup, adequate for prototype |
| 007 | FastAPI                     | Type-safe, async, auto-docs        |
| 008 | D3.js                       | Flexibility for custom viz         |
| 009 | Hybrid historical + live    | Realistic, seamless UX             |
| 010 | Prototype shortcuts         | Speed vs foundation balance        |
