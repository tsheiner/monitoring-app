# Distribution Terrain Layer Implementation Plan

## Summary

Implement the behavior defined in [Distribution Terrain Layer Specification](./distribution-terrain-layer-spec.md) as a frontend-only enhancement. Preserve the existing percentile bands, add a Canvas terrain renderer, and expose a Bands/Terrain selector with live terrain controls in the left rail.

## 1. Establish terrain types and defaults

- Add `DistributionStyle`, `TerrainSettings`, density-model, Gaussian-parameter, and renderer-configuration types.
- Create `frontend/src/chart/terrain/defaults.ts` as the single source for the five shipped slider defaults and neutral palette/raw rendering constants.
- Add pure mappings from the five perceptual settings to renderer values such as gradient gain, light direction, ambient level, contour interval, contrast, opacity, and saturation.
- Keep copied settings structurally identical to `DEFAULT_TERRAIN_SETTINGS` so the JSON from the app can be pasted into that file with minimal editing.

## 2. Build the pure terrain renderer

- Implement Gaussian `pdf` and analytic value-gradient functions behind the pluggable density-model interface.
- Convert the existing hourly `mean` and `stddev` baseline into timestamped descriptors, including the specified sigma fallbacks and linear parameter interpolation.
- Determine a metric-level reference sigma and fixed contour interval.
- Rasterize the visible density surface into an RGBA buffer using screen-space-normalized value and time gradients, neutral contour bands, antialiased contour lines, ambient light, and directional hillshading.
- Keep rasterization independent from the DOM so its mathematics and pixel output can be unit-tested.

## 3. Integrate Canvas with the chart

- Add a pointer-transparent Canvas aligned to the plot bounds beneath the existing SVG. Update its CSS position, backing dimensions, scales, and device-pixel ratio on resize.
- Let `ChartView` own one terrain layer for the active single metric while retaining the existing per-metric band generator.
- Add chart methods to set distribution style, apply terrain settings, and return the current settings for copying.
- Feed the terrain layer the same interpolated hourly baseline used by the current distribution system.
- Hide both distribution styles in multi-metric mode. Restore the selected style and current session settings when one metric remains.
- Coalesce slider redraws with `requestAnimationFrame`; use full visible-window redraws for baseline, scale, range, resize, and settings changes.

## 4. Add the left-rail controls

- Add a Distribution section beneath the existing metric toggles.
- Render a Bands/Terrain segmented selector, with Bands selected initially.
- When Terrain is active for a single metric, show sliders for Ridge definition, Time vs. shape, Contour detail, Relief, and Presence, each with a numeric value.
- Apply slider input directly to the running chart without fetching data.
- Add a Copy settings button that writes formatted JSON to the clipboard and provides brief copied or failure feedback.
- Keep settings in memory only. Omit reset, paste, persistence, synthetic scenarios, and save-as-default behavior.

## 5. Verification

### Unit tests

- Verify Gaussian symmetry, peak behavior, and the effect of sigma.
- Verify descriptor interpolation and each sigma fallback.
- Verify contour intervals remain fixed across time while responding to the metric reference sigma and contour-detail setting.
- Verify screen-space normalization produces comparable shading under different metric units and chart dimensions.
- Verify deterministic pixel output for representative narrow, broad, on-ridge, and off-ridge fixtures.
- Verify each perceptual setting changes its intended raw rendering parameters.

### Integration tests

- Verify Bands is the default and retains its current rendering path.
- Verify style switching preserves metric data, time range, Y domain, and live state.
- Verify Terrain appears only for a single metric and returns after leaving multi-metric mode.
- Verify slider input updates chart settings and Copy settings emits source-compatible JSON.
- Verify resizing and range changes realign and redraw the Canvas.

### Browser and performance verification

- Inspect representative network metrics over 1-hour, 6-hour, and 24-hour ranges.
- Confirm the measured line remains dominant and that narrow and broad baseline periods are visually distinguishable.
- Exercise metric toggling, live updates, zooming, panning, resizing, crosshair, tooltips, and event markers in both styles.
- Test standard and high-density displays and record full-redraw timings.
- If the specified 50 ms threshold is exceeded, add reduced-resolution rendering during active slider drags followed by a full-resolution render on release.
- Run the existing frontend test suite and production build before completion.

## Delivery boundaries

- No backend or API changes are required.
- No health encoding, prediction, additional density models, persisted settings, user-facing explanatory UI, synthetic scenario UI, or ring buffer is included.
- Existing unrelated workspace changes must remain untouched.
