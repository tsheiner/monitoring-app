# Agent Continuation Prompt: Complete Factor Decomposition Playbook

## Mission

You are taking over a monitoring application project that is **79% complete** (17 of 19 tasks done). Your mission is to **autonomously complete the remaining 2 tasks (FD-018 and FD-019)** following strict TDD methodology, browser verification standards, and git commit discipline.

**DO NOT ask for user approval to proceed between tasks.** Work continuously until both tasks are complete.

---

## Current State Summary

### ✅ What's Already Done (FD-001 to FD-017)

**Backend (68 tests passing):**
- Classifier architecture fully implemented (replaces retired shared drivers)
- Classifier OU processes generate all metric values
- Bootstrap generates classifier distributions and thresholds from simulation
- Perturbation system targets classifiers (e.g., `dhcp`, `radius_auth`, `dns`)
- HTTP API and WebSocket server expose optional `classifiers` field in observations
- Full backward compatibility: legacy consumers work without classifiers

**Frontend (36 tests passing):**
- Vitest test harness with happy-dom and mouse event utilities
- Chart rendering with D3.js scales, axes, and multi-metric line series
- Crosshair rendering (vertical + horizontal hairlines) on hover
- Nearest-metric detection by cursor Y-distance at cursor time X
- **Tooltip with active metric hysteresis** (FD-017 just completed):
  - Lists all visible metrics at cursor time
  - Expands classifier rows only for active metric
  - 150ms hysteresis timer prevents rapid active metric switching
  - Primary classifier highlighting (worst status, tie-break by deviation from 1.0)

**Infrastructure:**
- Dev servers: Backend on port 5011 (HTTP) + 8000 (WebSocket), Frontend on port 5012
- Git commits exist for each milestone through FD-017

### 🎯 What You Need to Complete (2 Tasks Remaining)

1. **FD-018**: Interaction state handling (hover, pan, live edge) - enforce crosshair/tooltip suppression during pan drag
2. **FD-019**: UI acceptance tests for complete crosshair/tooltip workflow

---

## Critical Requirements

### 1. TDD Methodology (NON-NEGOTIABLE)

For each task:
1. **Write tests FIRST** (red phase) - tests should fail initially
2. **Run tests** to confirm they fail for the right reason
3. **Implement minimal code** to make tests pass (green phase)
4. **Run tests again** to confirm they pass
5. **Create a git commit** with message format: `"FD-XXX complete: [brief description]"`

### 2. Browser Verification (MANDATORY for UI Tasks)

**From `.github/copilot-instructions.md`:**
> NEVER claim a task is complete without verifying it works using Playwright MCP.

For FD-018 and FD-019, you MUST:
1. Ensure dev servers are running (frontend on 5012, backend on 5011)
2. Use `mcp_playwright_browser_navigate` to load `http://localhost:5012`
3. Use `mcp_playwright_browser_click`, `mcp_playwright_browser_hover`, etc. to interact
4. Use `mcp_playwright_browser_snapshot` to verify DOM state
5. Capture screenshots if visual confirmation needed
6. **Close browser** with `mcp_playwright_browser_close` when done

**Note:** GitHub Copilot requires approval for each Playwright action. Expect 5-10 approval clicks per verification workflow. This is normal security behavior.

### 3. Git Commits at Milestones

After completing each task (FD-018, FD-019):
```bash
git add -A
git commit -m "FD-XXX complete: [description]"
```

Do NOT create a final summary document unless explicitly requested. Just complete the work and commit.

---

## Task Details

### FD-018: Interaction State Handling (hover, pan, live edge)

**Goal:** Enforce interaction state rules - suppress crosshair/tooltip during pan drag, restore on hover recovery.

**Dependencies:** FD-017 (complete ✅)

**Files to Modify:**
- `frontend/src/chart/ChartView.ts` (add pan detection and state management)
- `frontend/src/tests/` (create new test file or extend existing)

**Write Tests First:**
```typescript
// Test file: frontend/src/tests/interactionState.test.ts (create new)

describe('Interaction State Handling', () => {
  describe('Pan Suppression', () => {
    it('should suppress crosshair and tooltip during pan drag', () => {
      // Simulate mousedown, mousemove with dragging, verify no crosshair/tooltip
    });

    it('should restore hover affordances after pan drag ends', () => {
      // Simulate drag end (mouseup), then hover, verify crosshair/tooltip reappear
    });
  });

  describe('Live Edge Behavior', () => {
    it('should suppress or freeze tooltip near live streaming edge', () => {
      // Move cursor to right edge region, verify chosen policy (suppress or freeze)
    });
  });
});
```

**Implementation Approach:**
1. Add `isPanning: boolean` state to `ChartView`
2. Listen for `mousedown` on chart surface to start pan detection
3. Listen for `mousemove` with mouse button down to confirm dragging
4. Suppress `updateCrosshair()` and `updateTooltip()` calls when `isPanning === true`
5. Listen for `mouseup` to end pan state
6. Implement live-edge policy: if cursor X is within last 5% of time range, suppress or freeze tooltip

**Browser Verification Checklist:**
- [ ] Navigate to localhost:5012
- [ ] Click and drag on chart (pan action)
- [ ] Verify crosshair/tooltip do NOT appear during drag
- [ ] Release mouse button
- [ ] Hover over chart
- [ ] Verify crosshair/tooltip DO appear after pan ends
- [ ] Move cursor to far-right edge (live edge region)
- [ ] Verify tooltip behavior matches chosen policy (suppressed or frozen)
- [ ] Take snapshot to confirm final state

**Done Criteria:**
- All interaction state tests pass
- Browser verification confirms pan suppresses tooltip, hover recovers
- Git commit created: `"FD-018 complete: pan suppression and hover recovery"`
- Update playbook `current_task` to `"FD-019"`

---

### FD-019: UI Acceptance Tests for Crosshair Tooltip Workflow

**Goal:** Validate complete classifier tooltip UX with stable active-metric behavior through end-to-end UI tests.

**Dependencies:** FD-016, FD-017, FD-018 (all complete after FD-018 done)

**Files to Modify:**
- `frontend/src/tests/` (create new acceptance test file)

**Write Tests First:**
```typescript
// Test file: frontend/src/tests/acceptance.test.ts (create new)

describe('UI Acceptance Tests', () => {
  describe('Crosshair and Tooltip Workflow', () => {
    it('should show crosshair and tooltip on hover', () => {
      // Mount chart, add metric, hover, verify crosshair lines and tooltip visible
    });

    it('should change active metric when cursor repositions deliberately', () => {
      // Add 2 metrics, hover near first, wait >150ms, verify active class
      // Move cursor to second metric line, wait >150ms, verify active class switches
    });

    it('should not swap active metric during brief cursor pass near other line', () => {
      // Add 2 closely-spaced metrics at cursor time
      // Hover near first, verify active
      // Move cursor briefly (<150ms) near second, back to first
      // Verify active metric did NOT switch (hysteresis worked)
    });

    it('should render classifier rows only for active metric', () => {
      // Add metric, load observation with classifiers field from backend
      // Hover, verify tooltip shows metric value + classifier rows
      // Verify classifier rows have name, value, status indicator
    });

    it('should highlight primary classifier by worst status', () => {
      // Load observation with multiple classifiers (red, yellow, green statuses)
      // Verify classifier with worst status (red > yellow > green) is highlighted
      // If tie, verify tie-break by |1.0 - value| deviation
    });

    it('should leave sidebar behavior unchanged', () => {
      // Verify left sidebar metric list and buttons still work normally
      // Tooltip updates should not affect sidebar state
    });
  });
});
```

**Implementation Approach:**
1. Create deterministic test scenarios with closely-spaced metric lines
2. Use `simulateMouseMove()` from `mouseUtils.ts` for cursor control
3. Use `vi.advanceTimersByTime(200)` to advance past hysteresis window
4. Mock backend observations with `classifiers` field (see backend test fixtures for structure)
5. Query DOM for `.tooltip-metric.active` and `.tooltip-classifier` elements
6. Assert status indicators (red/yellow/green classes or styles)

**Classifier Data Structure (from backend):**
```typescript
interface ClassifierValue {
  name: string;       // e.g., "dhcp", "radius_auth"
  value: number;      // 0.0 to 1.0
  threshold: number;  // from bootstrap
  status: "good" | "warning" | "critical";
}

interface Observation {
  time: number;
  value: number;
  classifiers?: ClassifierValue[];  // Optional for backward compat
}
```

**Browser Verification Checklist:**
- [ ] Navigate to localhost:5012
- [ ] Add 2 metrics (e.g., "time_to_connect" and "throughput")
- [ ] Hover over first metric line
- [ ] Verify tooltip appears with both metrics, first is active (has "active" class)
- [ ] Wait 200ms, move cursor to second metric line
- [ ] Verify active metric switches to second
- [ ] Briefly move cursor between lines (<150ms)
- [ ] Verify active metric does NOT flip rapidly (hysteresis prevents)
- [ ] Take snapshots confirming tooltip structure and active metric behavior

**Done Criteria:**
- All acceptance tests pass (tooltip, active metric, hysteresis, classifier expansion)
- Browser verification confirms complete workflow
- Git commit created: `"FD-019 complete: UI acceptance tests for crosshair tooltip"`
- Update playbook: Mark FD-019 as `done`, set `current_task` to `"COMPLETE"`

---

## Key Files Reference

### Frontend Architecture

**Main Entry:**
- `frontend/src/main.ts` - App initialization, WebSocket setup, chart mounting

**Chart System:**
- `frontend/src/chart/ChartView.ts` - Main chart orchestrator (crosshair, tooltip, rendering)
- `frontend/src/chart/ChartCore.ts` - D3 scales, axes, series rendering
- `frontend/src/chart/DataTarget.ts` - Per-metric data buffering
- `frontend/src/chart/SharedRange.ts` - Time range coordination
- `frontend/src/chart/types.ts` - TypeScript interfaces

**Tests:**
- `frontend/src/tests/mousemove.test.ts` - Mouse event utilities
- `frontend/src/tests/chartSurface.test.ts` - Chart mounting and lifecycle
- `frontend/src/tests/crosshair.test.ts` - Crosshair rendering and nearest metric
- `frontend/src/tests/tooltip.test.ts` - Tooltip rendering and active metric hysteresis
- `frontend/src/tests/mouseUtils.ts` - Helper: `simulateMouseMove()`, `createMouseEvent()`

**Config:**
- `frontend/package.json` - Dependencies: Vitest 1.6.1, happy-dom 13.3.5, D3 v7.8.5
- `frontend/vite.config.ts` - Vitest configuration
- `frontend/tsconfig.json` - TypeScript settings

### Backend Architecture

**Main Entry:**
- `backend/main.py` - FastAPI app, WebSocket server, simulator bootstrap

**Simulator:**
- `backend/simulator/realistic_generator.py` - Classifier OU processes, metric derivation
- `backend/simulator/config.json` - Classifier definitions and metric mappings
- `backend/simulator/perturbations.py` - Event-based perturbation system
- `backend/simulator/bootstrap.py` - Generate classifier distributions and thresholds

**Server:**
- `backend/server/http_api.py` - REST endpoints for baselines and historical data
- `backend/server/websocket_server.py` - Real-time metric streaming
- `backend/server/models.py` - Pydantic models (Observation, ClassifierValue, etc.)

**Storage:**
- `backend/storage/metrics_store.py` - CSV append-only metric storage
- `backend/storage/events_store.py` - SQLite event log

**Tests:**
- `backend/tests/conftest.py` - Pytest fixtures (deterministic seed, temp dirs, isolated stores)
- `backend/tests/test_classifier_*.py` - Classifier engine, thresholds, storage, endpoints
- `backend/tests/test_event_templates.py` - Perturbation event templates
- `backend/tests/test_websocket_classifiers.py` - WebSocket message format with classifiers

**Config:**
- `backend/requirements.txt` - Dependencies: FastAPI, pytest, numpy, pandas, etc.

### Documentation

- `docs/factor-decomposition-tdd-playbook.md` - **YOUR PRIMARY REFERENCE** (task catalog, dependencies, done criteria)
- `docs/factor-decomposition-plan.md` - Original design spec for classifier architecture
- `.github/copilot-instructions.md` - **CRITICAL**: Contains Playwright MCP verification requirements

---

## Execution Workflow

### Step-by-Step Process

1. **Verify Current State**
   ```bash
   cd /Users/tsheiner/Work/monitoring-app
   git status  # Should be clean with FD-017 committed
   ```

2. **Start FD-018**
   ```bash
   cd frontend
   # Create test file
   # Write tests for pan suppression and hover recovery (TDD red phase)
   npm test  # Verify tests fail
   # Implement interaction state handling in ChartView.ts
   npm test  # Verify tests pass (TDD green phase)
   ```

3. **Browser Verify FD-018**
   ```bash
   # Ensure servers running:
   # Backend: cd backend && conda run -n monitoring-app python main.py (port 5011, 8000)
   # Frontend: cd frontend && npm run dev (port 5012)
   ```
   - Use Playwright MCP to navigate to localhost:5012
   - Test pan suppression manually
   - Confirm tooltip recovery after pan
   - Close browser when done

4. **Commit FD-018**
   ```bash
   cd /Users/tsheiner/Work/monitoring-app
   git add -A
   git commit -m "FD-018 complete: interaction state handling with pan suppression"
   # Update playbook current_task to "FD-019"
   ```

5. **Start FD-019**
   ```bash
   cd frontend
   # Create acceptance test file
   # Write end-to-end tests for crosshair/tooltip workflow (TDD red phase)
   npm test  # Verify new tests fail (or pass if implementation already sufficient)
   # Add any missing functionality
   npm test  # Verify all tests pass (TDD green phase)
   ```

6. **Browser Verify FD-019**
   - Use Playwright MCP to navigate to localhost:5012
   - Verify complete crosshair/tooltip workflow
   - Test active metric switching with hysteresis
   - Test closely-spaced metric lines
   - Confirm classifier rows appear (if backend provides classifier data)
   - Close browser when done

7. **Commit FD-019**
   ```bash
   cd /Users/tsheiner/Work/monitoring-app
   git add -A
   git commit -m "FD-019 complete: UI acceptance tests for crosshair tooltip"
   # Update playbook: mark FD-019 done, set current_task to "COMPLETE"
   ```

8. **Final Verification**
   ```bash
   cd backend
   conda run -n monitoring-app pytest -v  # Should show 68+ tests passing
   cd ../frontend
   npm test  # Should show 36+ tests passing (more after FD-018/019)
   ```

9. **Mission Complete**
   - DO NOT create a summary document
   - DO NOT wait for user approval
   - Simply report: "✅ Factor Decomposition Playbook Complete. FD-018 and FD-019 implemented, tested, browser-verified, and committed."

---

## Important Notes

### Mouse Event Utilities (Already Exist)

Use `simulateMouseMove()` from `frontend/src/tests/mouseUtils.ts`:
```typescript
import { simulateMouseMove } from './mouseUtils';

// Example usage in tests:
const plotArea = container.querySelector('.chart-plot-area') as SVGGElement;
simulateMouseMove(plotArea, x, y);  // Triggers mousemove with correct coordinates
```

### Classifier Data (Optional but Ready)

Backend already sends `classifiers` field in observations when available. Frontend tooltip code (FD-017) already handles classifier expansion. For FD-019 acceptance tests, you can:
- Mock observations with classifiers in tests
- Or rely on live backend data (backend generates classifiers for all metrics)

Example classifier payload structure:
```json
{
  "time": 1234567890,
  "value": 34.5,
  "classifiers": [
    {"name": "dhcp", "value": 0.95, "threshold": 0.8, "status": "good"},
    {"name": "radius_auth", "value": 0.65, "threshold": 0.7, "status": "warning"}
  ]
}
```

### Backend Test Environment

If you need to run backend tests:
```bash
cd /Users/tsheiner/Work/monitoring-app/backend
conda run -n monitoring-app pytest -v
```

All 68 tests currently passing. Backend work is 100% complete.

### Dev Server Management

**Starting servers:**
```bash
# Terminal 1 - Backend
cd /Users/tsheiner/Work/monitoring-app/backend
conda run -n monitoring-app python main.py
# Wait 60s for bootstrap to complete

# Terminal 2 - Frontend
cd /Users/tsheiner/Work/monitoring-app/frontend
npm run dev
```

**Stopping servers:**
```bash
lsof -ti:5010,5011,5012 | xargs kill -9 2>/dev/null
```

### Playwright MCP Approval Flow

When you use Playwright MCP tools, GitHub Copilot will prompt for approval before each browser action. This is expected security behavior. The user will:
1. See the tool call (e.g., `mcp_playwright_browser_navigate`)
2. Press Tab + Enter to approve
3. Repeat for each subsequent action (click, hover, snapshot, etc.)

**You should batch browser actions logically** but expect 5-10 approval prompts per verification session.

---

## Success Criteria Checklist

Before reporting completion, verify:

### FD-018 Complete:
- [ ] Tests written first (TDD red phase)
- [ ] Tests initially failed
- [ ] Implementation added to ChartView.ts
- [ ] All tests now pass (TDD green phase)
- [ ] Browser verification: pan suppresses tooltip ✅
- [ ] Browser verification: hover recovers after pan ✅
- [ ] Git commit created with message "FD-018 complete: ..."
- [ ] Playbook updated: current_task = "FD-019"

### FD-019 Complete:
- [ ] Acceptance tests written first (TDD red phase)
- [ ] Tests cover: hover workflow, active metric switching, hysteresis, classifier expansion
- [ ] All tests pass (TDD green phase)
- [ ] Browser verification: crosshair/tooltip workflow ✅
- [ ] Browser verification: active metric hysteresis prevents rapid cycling ✅
- [ ] Browser verification: sidebar behavior unchanged ✅
- [ ] Git commit created with message "FD-019 complete: ..."
- [ ] Playbook updated: FD-019 marked done, current_task = "COMPLETE"

### Overall:
- [ ] Frontend tests: 36+ passing (likely 44-50 after FD-018/019 tests added)
- [ ] Backend tests: 68 passing (unchanged)
- [ ] No linter errors introduced
- [ ] Dev servers still functional
- [ ] All git commits created

---

## Final Instructions

1. **Read this entire prompt carefully.**
2. **Start with FD-018 immediately.** Do not ask permission.
3. **Follow TDD strictly:** tests first, red, implement, green, commit.
4. **Use Playwright MCP for browser verification** (mandatory per copilot-instructions).
5. **Create git commits at each milestone** (FD-018, FD-019).
6. **Work continuously** through both tasks without stopping.
7. **Report completion succinctly** when done - no summary document needed.

**Begin now. Good luck! 🚀**
