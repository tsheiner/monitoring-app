# Claude Project Instructions

Context and preferences for AI assistance on this project.

## Project Overview

Building a network monitoring prototype with:

- Simulated network metrics (7 metrics based on Juniper Mist standards)
- Event stream (device lifecycle, config changes, AI actions)
- Real-time + historical timeseries visualization
- Distribution ribbon showing variance over time

**Purpose**: Demonstrate self-healing network monitoring capabilities to executives. Prototype, not production system, but must be extensible.

## Key Principles

1. **Foundation over features**: Invest in data schemas, storage API, chart architecture. Cut corners on error handling, tests, auth.

2. **Prototype realism**: Should look/feel like a real system, but skip production concerns (scale, security, ops).

3. **Extensibility**: Design decisions documented in `docs/decisions.md`. Future may go toward AI explainability OR human planning tools - stay flexible.

4. **Cost/benefit balance**: Speed matters, but not at expense of rework. Data layer must be solid.

## Documentation Structure

**Always read these docs first before planning**:

- `docs/architecture.md` - System design, data flow
- `docs/metrics-schema.md` - 7 network metrics, formats
- `docs/event-schema.md` - Event types, correlation
- `docs/decisions.md` - Architecture Decision Records
- `docs/chart-design.md` - Timeseries chart architecture (from juttle-viz patterns)

**References** (background, less critical):

- `docs/references/mock-data-tools.md` - Tool research
- `docs/references/juttle-viz.md` - Legacy system patterns
- `docs/references/design-philosophy.md` - Tim's design thinking

## User (Tim) Preferences

- **Ask for clarification** when needed, but don't over-ask. Make educated guesses and state assumptions.
- **Push back** if you have good technical reasons. Tim wants sound engineering, not blind agreement.
- **Be explicit about trade-offs**: Speed vs quality, simplicity vs extensibility, prototype vs production.
- **Stay focused on infrastructure**: Right now, we're building the data pipeline + chart. Application features (alerts, dashboards) come later.

## Current Phase

**Phase 1**: Backend data infrastructure

- Simulator (Darts + event generator)
- Storage (TinyFlux + SQLite)
- Event bus (WebSocket broadcast)
- Query API (FastAPI)

See `docs/architecture.md` for implementation checkpoints.

## Tech Stack

Backend: Python, Darts, TinyFlux, SQLite, websockets, FastAPI
Frontend: TypeScript, Vite, D3.js v7
(See `docs/decisions.md` for rationale)

## What to Avoid

- Don't suggest production features (auth, clustering, etc.) - prototype only
- Don't use heavyweight tools (Kubernetes, microservices) - single machine, local dev
- Don't add frameworks we don't need (React/Vue) - vanilla TypeScript + D3
- Don't create tests yet - manual validation sufficient for prototype
