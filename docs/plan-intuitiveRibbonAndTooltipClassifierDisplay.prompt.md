# Plan: Intuitive Ribbon & Tooltip Classifier Display

## Problem Statement

The current UI creates confusion because:

1. **Classifier scores are opaque** — displayed as arbitrary 0-100 numbers with pass/fail icons, but the numbers are unitless internal values with no reference to "normal," making it impossible to interpret why "75" is red
2. **Two competing status systems** — the metric icon (percentile-based, symmetric) and classifier icons (threshold-based, one-tailed) answer different statistical questions and frequently disagree
3. **Ribbon doesn't communicate status zones** — all bands use the metric's line color at different opacities, so a point at p12 (warning territory) looks visually "inside the ribbon" and normal
4. **Metric line colors clash with status semantics** — orange, green, and red metric lines conflict with status-colored ribbon bands; ap_health and time_to_connect are also indistinguishable

## Approach

- Reframe the tooltip: metric icon = "where is the point in the distribution" + classifier gauges = "what's driving it there." Two complementary roles, not competing verdicts.
- Replace classifier numeric readouts/icons with zone-colored gauge tracks
- Replace monochrome ribbon with status-colored bands (3 bands, opacity preserved for density feel)
- Rethink all 7 metric line colors for ribbon contrast and mutual distinctness

---

## Phase 1: Ribbon — Semantic Status Colors (frontend only)

### Step 1.1: Reduce to 3 bands with status colors

**File**: `frontend/src/chart/generators/DistributionRibbonGenerator.ts`

Change the `bands` array (~line 60) from 4 single-color bands to 3 status-colored bands:

- p25–p75: green @ 0.25 (inner, healthy)
- p10–p90: yellow/amber @ 0.18 (middle, warning)
- p5–p95: orange-red @ 0.12 (outer, critical)

Replace `this.color` in band `.attr("fill", ...)` with the per-band status color. Keep back-to-front render order so green paints over yellow/red in center.

### Step 1.2: Keep p50 line as-is

The p50 expectation line stays dark (`#2a2a2a`) — subtle background reference.

### Step 1.3: Define shared status color constants

Create a small constants object (in `types.ts` or top of `ChartView.ts`) with the 3 zone colors, reused by both ribbon bands and tooltip gauges in Phase 3.

Candidate palette (TBD, needs visual testing):

- Green: `#27AE60`
- Yellow/amber: `#F0C243`
- Orange-red: `#E74C3C`

---

## Phase 2: Metric Line Colors (frontend only, parallel with Phase 1)

### Step 2.1: Replace all 7 metric colors

**File**: `frontend/src/main.ts` (lines ~97-117)

Constraint: all lines must contrast against dark background (#2A2A2A) AND green/yellow/orange-red ribbon bands. Safe hues: blue, cyan, purple, magenta/pink, lavender.

| Metric | Current | Problem |
|--------|---------|---------|
| Time to Connect | `#E67E22` orange | Clashes with yellow/orange bands |
| Throughput | `#3498DB` blue | Safe |
| Coverage | `#2ECC71` green | Clashes with green band |
| Capacity | `#9B59B6` purple | Safe |
| Roaming | `#E74C3C` red | Clashes with red band |
| Successful Connects | `#1ABC9C` teal | Safe-ish but close to green |
| AP Health | `#F39C12` amber | Clashes with yellow band, too close to Time to Connect |

All 7 get new values chosen from blue/cyan/purple/magenta/pink/lavender family. Exact hex values finalized via visual testing.

---

## Phase 3: Tooltip Classifier Gauges (frontend + API integration)

### Step 3.1: Load classifier baselines on frontend

**File**: `frontend/src/api/client.ts` — add `fetchClassifierBaseline(classifier: string)` method calling existing endpoint `/api/classifiers/{classifier}/baseline`

**File**: `frontend/src/main.ts` — after loading metric baselines, also load classifier baselines for each classifier appearing in observations. Store in a Map passed to ChartView.

### Step 3.2: Pass classifier baselines to ChartView

**File**: `frontend/src/chart/ChartView.ts`

Add a method to receive classifier baseline data: `Map<classifierName, Array<{ hour, distribution: { p5, p10, p25, p75, p90, p95 } }>>`. The tooltip builder needs per-classifier thresholds for the cursor's hour.

**File**: `frontend/src/chart/types.ts` — add type for classifier baseline data if needed.

### Step 3.3: Replace classifier rows with gauge tracks

**File**: `frontend/src/chart/ChartView.ts` — `buildTooltipContent()` method (lines ~755-785)

Remove per-classifier: numeric display (`displayVal`), `statusIcon()` call.

Replace with inline SVG gauge per classifier row:

- Track: ~80–100px wide, 6–8px tall, rounded corners
- 3 colored zone rectangles proportional to classifier's hourly thresholds:
  - Red/orange zone: p5 to p10 (left)
  - Yellow zone: p10 to p25 (middle-left)
  - Green zone: p25 to p95 (right, largest)
- Scale maps to classifier's own p5–p95 range (statistically accurate zone widths)
- Value marker: thin white vertical line (1–2px) at classifier's current position
- No numeric readout
- Primary classifier (worst status) still gets bold label via `findPrimaryClassifier()`

Implementation: render as inline `<svg>` with 3 `<rect>` + 1 `<line>` elements.

### Step 3.4: Remove classifier status icons

Remove `ChartView.statusIcon(classifierStatus, 9)` call from classifier rows. Keep `statusIcon()` for metric-level icon only.

---

## Phase 4: No Backend Changes Needed

- WebSocket already sends `name`, `value`, `status`, `contribution`, `weight` per classifier
- `/api/classifiers/{classifier}/baseline` already returns hourly distributions with p5–p95
- `getMetricStatus()` (percentile-based, symmetric) stays as-is for metric icon

---

## Relevant Files

- `frontend/src/chart/generators/DistributionRibbonGenerator.ts` — ribbon band colors/count (Phase 1)
- `frontend/src/main.ts` lines 97–117 — metric color definitions (Phase 2)
- `frontend/src/chart/ChartView.ts` — tooltip rendering: `buildTooltipContent()` L700–790, `statusIcon()`, `getMetricStatus()` L588, `findPrimaryClassifier()` L800 (Phase 3)
- `frontend/src/api/client.ts` — API client, add classifier baseline fetch (Phase 3)
- `frontend/src/chart/types.ts` — `ClassifierValue` type, shared color constants (Phase 1+3)

## Verification

1. Run `npx vitest` — update existing tooltip/chart tests for new classifier row format (no numeric, no icon, SVG gauge instead)
2. Playwright MCP visual verification:
   - Select each metric individually, verify ribbon shows 3 status-colored bands (green center, yellow mid, orange-red outer) with opacity variation
   - Hover data points, verify classifier rows show gauge tracks with markers, no numbers or icons
   - Verify metric line is clearly visible against all 3 ribbon band colors
   - Verify all 7 metric lines are perceptually distinct from each other
   - Check tooltip near extremes (data outside p5–p95 ribbon)
   - Check metrics with different classifier counts (3 for roaming, 5 for coverage)

## Decisions

- 3 bands (p5–p95 coverage, ~2σ) instead of 4 — cleaner, sufficient range
- Classifier numeric readout removed — values are unitless internal state
- Classifier status icons removed — one metric-level icon only, gauges explain rather than judge
- Metric icon stays percentile-based — matches ribbon zones, visually verifiable
- p50 line stays as `#2a2a2a` — subtle background reference
- Full 7-color metric palette rethink — visual clarity highest priority, no existing user base
- Gauge scale is per-classifier from its own p5–p95 — statistically accurate zone widths
- No ribbon borders or annotations — colors carry meaning, opacity preserves distribution feel
- Ribbon band opacity retained (0.12, 0.18, 0.25) — preserves density/frequency distribution suggestion
