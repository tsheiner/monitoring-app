# Distribution Terrain Layer Implementation Plan

## Summary

Implement the behavior defined in [Distribution Terrain Layer Specification](./distribution-terrain-layer-spec.md) as a sequence of independently verified increments. Preserve the existing percentile bands, add a Canvas terrain renderer, and expose a Bands/Terrain selector with live terrain controls in the left rail.

Every step has a verification gate. Do not begin the next step until the current gate passes. Commit boundaries should follow these steps so each increment can be reviewed or reverted independently.

## Estimated impact

The implementation is expected to affect approximately 14–20 files in total:

- 6–8 new terrain implementation files
- 4–6 new or expanded test files
- 5–7 existing chart, app, style, and test-support files
- 2 documentation files, already established

Likely existing files touched during implementation:

- `frontend/src/chart/types.ts`
- `frontend/src/chart/ChartCore.ts`
- `frontend/src/chart/ChartView.ts`
- `frontend/src/main.ts`
- `frontend/index.html`
- `frontend/src/style.css`
- `frontend/src/tests/setup.ts`, if Canvas DOM methods require test mocks

The exact test-file grouping may change to follow the repository's existing conventions. Production responsibilities and step gates must remain as described below.

## Step 0 — Establish a clean baseline

### Outcome

Confirm that current behavior is healthy before terrain code is introduced.

### Expected file impact

- No product-file changes
- No planned test-file changes

### Work

- Run the complete frontend test suite.
- Run the production TypeScript/Vite build.
- Record current Bands behavior for one metric, multiple metrics, resizing, and live updates.
- Confirm the current distribution disappears in multi-metric mode and returns when one metric remains.

### Verification gate

Advance only when:

- `npm test` passes.
- `npm run build` passes.
- Existing Bands behavior has been observed in the browser without a terrain-related code change.

## Step 1 — Add terrain types, defaults, and baseline adaptation

### Outcome

Create the data and configuration foundation without rendering or UI changes. The app must continue to behave exactly as it does today.

### Expected file impact: 5–7 files

Likely additions:

- `frontend/src/chart/terrain/types.ts`
- `frontend/src/chart/terrain/defaults.ts`
- `frontend/src/chart/terrain/GaussianDensity.ts`
- `frontend/src/chart/terrain/baselineAdapter.ts`
- `frontend/src/tests/terrainData.test.ts`

Likely existing change:

- `frontend/src/chart/types.ts`

### Work

- Add `DistributionStyle`, `TerrainSettings`, density-model, Gaussian-parameter, and resolved-renderer configuration types.
- Add `DEFAULT_TERRAIN_SETTINGS` with the five source-controlled defaults and neutral palette constants.
- Implement Gaussian density and analytic value-gradient functions.
- Convert hourly baselines into timestamped `mu` and `sigma` descriptors.
- Implement the stddev, IQR, and Y-span sigma fallback sequence.
- Implement linear parameter interpolation and metric-level reference-sigma calculation.
- Add pure mappings from the five perceptual settings to raw renderer values.

### Required tests

- Gaussian density is symmetric around `mu` and peaks at `mu`.
- Smaller sigma produces a taller peak; larger sigma produces a broader density.
- Analytic gradients agree with numerical differencing within tolerance.
- Hourly parameter interpolation handles normal hours and midnight wraparound.
- Sigma fallback order is deterministic and always produces a finite positive value.
- Median reference sigma is independent of the visible observation count.
- Every slider value is clamped to `0–1` and maps deterministically to raw parameters.

### Verification gate

Advance only when:

- Targeted terrain-data tests pass.
- The complete existing frontend test suite passes.
- `npm run build` passes with strict TypeScript checks.
- The running app remains visually unchanged because no terrain renderer is mounted yet.

## Step 2 — Build and verify the pure raster renderer

### Outcome

Produce deterministic RGBA terrain buffers from distribution descriptors without touching the DOM or main chart.

### Expected file impact: 3–5 files

Likely additions:

- `frontend/src/chart/terrain/TerrainRasterizer.ts`
- `frontend/src/chart/terrain/color.ts`
- `frontend/src/tests/terrainRasterizer.test.ts`

Possible changes:

- Terrain types and defaults from Step 1

### Work

- Rasterize the density field into a caller-provided RGBA buffer.
- Calculate screen-space-normalized value and backward time gradients.
- Apply fixed contour bands, antialiased contour lines, ambient light, and directional hillshading.
- Keep contour intervals fixed across time for a metric.
- Apply the neutral slate palette and overall presence without health colors.
- Keep all calculations independent from Canvas, D3, and browser DOM APIs.

### Required tests

- Rendering the same inputs twice produces byte-identical output.
- Every output byte is finite and within `0–255`; no NaN or invalid density reaches the buffer.
- A constant distribution produces a calm horizontal ridge.
- A narrow distribution has a sharper profile and more contour crossings than a broad distribution under the same settings.
- The same field rendered under equivalent screen-space scales produces comparable shading.
- `presence: 0` produces a fully transparent buffer.
- Changing contour detail does not change density or hillshade calculations.
- Changing presence does not move contours or alter terrain structure.

### Verification gate

Advance only when:

- All rasterizer tests pass.
- Step 1 tests continue to pass.
- The complete frontend test suite passes.
- `npm run build` passes.
- A development assertion confirms a representative buffer contains both transparent background pixels and visible terrain pixels.

## Step 3 — Mount Terrain behind the SVG chart

### Outcome

Integrate the Canvas layer with the chart behind all measured-series and interaction elements. Terrain remains unreachable from the regular UI until Step 4.

### Expected file impact: 5–7 files

Likely addition:

- `frontend/src/chart/terrain/TerrainCanvasLayer.ts`
- `frontend/src/tests/terrainChartIntegration.test.ts`

Likely existing changes:

- `frontend/src/chart/ChartCore.ts`
- `frontend/src/chart/ChartView.ts`
- `frontend/src/style.css`
- `frontend/src/tests/setup.ts`, if Canvas mocks are needed

### Work

- Add a pointer-transparent Canvas aligned with the SVG plot bounds and positioned beneath the SVG.
- Size the backing buffer at device-pixel resolution, capped at device-pixel ratio 2.
- Add ChartView methods to select distribution style, apply terrain settings, and read current settings.
- Feed the terrain layer the selected metric's existing hourly baseline.
- Redraw on baseline, X/Y scale, range, resize, and setting changes.
- Hide Terrain when baseline data is unavailable or multiple metrics are active.
- Retain the selected style and session settings while Terrain is temporarily hidden.
- Coalesce repeated render requests with `requestAnimationFrame`.

### Required tests

- Canvas is created once, has `pointer-events: none`, and is removed during chart destruction.
- Canvas dimensions and plot offsets follow chart margins, resize, and device-pixel ratio.
- Terrain renders behind the SVG line and interaction layers.
- Programmatically selecting Terrain does not reload or mutate observations.
- Terrain hides in multi-metric mode and returns when one metric remains.
- Missing or invalid baseline data hides Terrain safely.
- Existing line, crosshair, tooltip, event-marker, zoom, and resize tests continue to pass.

### Verification gate

Advance only when:

- Terrain can be enabled programmatically in a browser and aligns with the measured line across the full plot.
- Crosshair, tooltip, event, zoom, pan, resize, and live-update interactions still work.
- All targeted integration tests pass.
- The complete frontend test suite and production build pass.
- Bands remains visually unchanged when Terrain is inactive.

## Step 4 — Add the Bands/Terrain selector

### Outcome

Make the new renderer user-selectable while retaining Bands as the initial experience.

### Expected file impact: 4–6 files

Likely existing changes:

- `frontend/index.html`
- `frontend/src/main.ts`
- `frontend/src/style.css`
- `frontend/src/chart/ChartView.ts`

Likely test change or addition:

- `frontend/src/tests/terrainControls.test.ts`

### Work

- Add a Distribution section beneath the metric controls in the left rail.
- Add a Bands/Terrain segmented selector with Bands selected initially.
- Switch renderers immediately without fetching data or changing chart state.
- Hide the Distribution section when the active metric count is not exactly one.
- Preserve the selected style when the section temporarily disappears.

### Required tests

- Bands is selected on startup.
- Selecting Terrain shows the Canvas and hides the SVG bands.
- Selecting Bands hides the Canvas and restores the existing bands.
- Switching styles preserves observations, active metric, time range, Y domain, live mode, and events.
- Distribution controls hide in multi-metric mode and return with their previous selection.
- Selector keyboard focus and activation work with native controls.

### Verification gate

Advance only when:

- The selector works against actual simulator data in the running app.
- Ten repeated Bands/Terrain switches produce no duplicate Canvas or SVG layers.
- Single-to-multi-to-single metric transitions restore the correct style.
- All targeted controls tests, the complete frontend suite, and the production build pass.

## Step 5 — Add live sliders and Copy settings

### Outcome

Allow the terrain to be tuned directly against actual network data and make the chosen values easy to transfer into source control.

### Expected file impact: 4–6 files

Likely addition:

- `frontend/src/chart/terrain/TerrainControls.ts`

Likely existing changes:

- `frontend/src/main.ts`
- `frontend/src/style.css`
- `frontend/index.html`
- `frontend/src/tests/terrainControls.test.ts`

### Work

- Show five sliders only when Terrain is selected for exactly one metric.
- Label sliders Ridge definition, Time vs. shape, Contour detail, Relief, and Presence.
- Display each current value to two decimal places.
- Apply changes to the actual chart during slider input and coalesce redraws through `requestAnimationFrame`.
- Add Copy settings to copy formatted JSON matching `DEFAULT_TERRAIN_SETTINGS`.
- Show brief copied or failure feedback.
- Keep settings in memory only; reload restores the source-controlled defaults.

### Required tests

- Controls initialize from `DEFAULT_TERRAIN_SETTINGS`.
- Each slider updates only its corresponding setting and displayed value.
- ChartView receives coalesced settings updates during repeated slider input.
- Copy settings emits valid JSON with exactly the five expected keys and current values.
- Clipboard failure produces visible feedback without changing settings.
- Sliders retain session values through metric and style changes.
- Reload behavior remains source-driven; no local storage is written.

### Verification gate

Advance only when:

- All five sliders visibly update Terrain against simulator data.
- Slider dragging remains responsive and the measured line remains readable at every default setting.
- Copied JSON can replace the object in `frontend/src/chart/terrain/defaults.ts` and pass the TypeScript build without editing its structure.
- Targeted control tests, the complete frontend suite, and the production build pass.

## Step 6 — Visual acceptance and performance hardening

### Outcome

Verify that the integrated visualization answers the intended questions and performs smoothly in the real app.

### Expected file impact: 0–4 files

No changes are required if all acceptance and performance checks pass. Potential changes are limited to terrain defaults, renderer internals, styles, or browser-test coverage.

### Work

- Inspect representative metrics over 1-hour, 6-hour, and 24-hour ranges.
- Evaluate whether the measured line reads as typical near the ridge and unusual on its outer slopes.
- Compare periods and metrics with narrower and broader baseline variance.
- Exercise live updates, zooming, panning, resizing, crosshair, tooltips, events, metric changes, and style changes.
- Measure full redraw time at representative chart sizes and device-pixel ratios.
- Tune only through the five settings first; change raw renderer constants only when slider ranges cannot reach an acceptable result.

### Required browser checks

- Bands remains visually identical to the baseline captured in Step 0.
- Terrain uses neutral colors and suggests no health or severity meaning.
- The measured line remains the dominant foreground element.
- Narrow periods appear sharper and more densely contoured than broad periods.
- Expected-ridge movement remains visible without dominating distribution shape.
- No stale pixels, seams, clipping errors, duplicate layers, or line/terrain misalignment appear during interaction.
- Crosshair, tooltip, event, and zoom interactions remain fully usable.

### Performance gate

- Measure a 1000 by 500 CSS-pixel plot at device-pixel ratio 2.
- If slider redraw p95 is at or below 50 ms, retain full-resolution rendering.
- If slider redraw p95 exceeds 50 ms, add reduced-resolution previews during active dragging and a full-resolution redraw on release, then repeat the measurement.
- Do not introduce ring-buffer rendering during this step.

### Final verification gate

Complete the feature only when:

- All acceptance criteria in the specification pass in the browser.
- The complete frontend test suite passes.
- The production build passes.
- Performance meets the rule above.
- Copied settings match the committed source defaults selected during tuning.
- `git diff --check` reports no whitespace errors.

## Delivery boundaries

- No backend or API changes are required.
- No health encoding, prediction, additional density models, persisted settings, user-facing explanatory UI, synthetic scenario UI, or ring buffer is included.
- Existing unrelated workspace changes must remain untouched.
