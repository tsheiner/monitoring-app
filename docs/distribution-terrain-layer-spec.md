# Distribution Terrain Layer Specification

## Purpose

Add an alternative historical-distribution display to the existing time-series chart. The measured series remains the primary foreground element. A hillshaded terrain layer shows which values are usual at each time and how much those values normally vary.

The visual metaphor is a topographic map built from historical observations:

- Frequently observed values form a ridge.
- Progressively less common values lie down the ridge's slopes.
- A measured line following the ridge is behaving typically.
- A measured line leaving the ridge is becoming unusual.
- A narrow, steep ridge represents a metric that is normally consistent.
- A broad, gentle hill represents a metric that normally varies more.

The rendering should help a viewer answer these questions without requiring statistical training:

1. Is this measured value typical?
2. Where did the measured value become unusual?
3. Which periods were more predictable?

## Visual priorities

The visualization has three priorities, in this order:

1. **Measured value relative to expectation** — the position of the measured line relative to the ridge must be immediately legible.
2. **Normal variability** — narrow and broad historical distributions must feel visibly different.
3. **Change in expectation** — movement of the expected ridge over time should remain visible as a secondary characteristic of the terrain.

The terrain communicates typicality only. It must not imply health, severity, success, or failure. Color may encode increasing density or elevation through a perceptually ordered sequential palette. Avoid traffic-light green/yellow/red progression and other status semantics. Any future health decoration will be a separate visual channel.

## Display modes

Add a distribution-style setting with two values:

```ts
type DistributionStyle = "bands" | "terrain";
```

- `bands` preserves the current percentile-band display and remains the initial default.
- `terrain` displays the new hillshaded distribution layer.
- Switching styles must preserve the selected metric, observations, time range, vertical scale, live state, and chart interactions.
- Distribution layers remain available only when one metric is displayed. When multiple metrics are displayed, hide both styles while retaining the selected style for the next single-metric view.
- The measured line, points, event markers, axes, crosshair, and tooltips always render above the terrain.

## Historical distribution data

Use the app's existing 30-day hourly metric baselines. The first implementation converts each hourly distribution into Gaussian parameters:

```ts
interface DistributionDescriptor {
  timestamp: number;
  params: {
    mu: number;
    sigma: number;
  };
}
```

- Set `mu` from the baseline distribution's `mean`.
- Set `sigma` from `stddev` when it is finite and positive.
- If `stddev` is invalid, estimate sigma as `(p75 - p25) / 1.349`.
- If both values are invalid, use a small positive fallback derived from the current Y-axis span.
- Interpolate parameters linearly between hourly baseline descriptors. Do not interpolate already-computed density values.
- Follow the same hour-of-day behavior used by the current baseline-band renderer.

The density calculation must use a pluggable interface so predicted, skewed, empirical, or mixture distributions can be added later:

```ts
interface DensityModel<Params> {
  pdf(value: number, params: Params): number;
  dpdfDy?: (value: number, params: Params) => number;
}
```

Use numerical value-axis differencing when a model does not supply `dpdfDy`.

## Elevation field

Define a scalar field across the chart's plot area:

```text
z(time, value) = probability density of value at time
```

Do not normalize density independently in each time column. Absolute density within a metric provides the variability encoding:

- Smaller sigma produces a taller, sharper density surface.
- Larger sigma produces a lower, broader density surface.

Density values have different units across metrics. Derive the contour reference separately for each metric from the median valid sigma in its baseline. Keep that contour reference fixed across the metric's visible time range.

## Rendering

Render the terrain into a Canvas `ImageData` buffer positioned behind the existing SVG chart content. The Canvas must ignore pointer events and align exactly with the SVG plot bounds and scales.

### Contour bands and lines

- Use a fixed contour interval within the selected metric and current settings.
- Map contour indices to a non-status sequential density ramp with distinct low, middle, and ridge stops.
- Let higher-density regions increase in saturation and luminance while preserving foreground-line contrast.
- Draw subtle antialiased contour lines using a pixel-aware threshold.
- Never adapt the contour interval independently for each time column.

The `contourDetail` setting may change the fixed interval for the whole terrain. It must preserve the relative difference between narrow and broad periods.

### Hillshading

Compute a surface normal from density gradients in screen space:

- Calculate the value-axis gradient analytically when available.
- Calculate the time-axis gradient from the current and previous horizontal pixel.
- Convert both gradients into per-pixel units and scale them relative to the fixed contour interval. This prevents metric units and chart aspect ratio from arbitrarily changing the shading.

Use Lambertian-style directional lighting with an ambient component. The default light should emphasize the ridge's cross-sectional shape, with a smaller time-axis component that reveals gradual movement. Temporal changes should remain visible without dominating the measured-line-to-ridge relationship.

The observed series must remain clearly readable at every default setting. Setting terrain presence to zero must leave the host chart visually unchanged.

## Terrain settings

Expose seven live settings, each represented as a number from 0 to 1:

```ts
interface TerrainSettings {
  ridgeDefinition: number;
  timeVsShapeBias: number;
  contourDetail: number;
  relief: number;
  presence: number;
  colorContrast: number;
  distributionExtent: number;
}
```

Initial source-controlled defaults:

```ts
{
  ridgeDefinition: 0.72,
  timeVsShapeBias: 0.30,
  contourDetail: 0.55,
  relief: 0.68,
  presence: 0.72,
  colorContrast: 0.78,
  distributionExtent: 0.68
}
```

Settings have the following meanings:

1. **Ridge definition** — increases the value-axis gradient gain so ridge shape and slopes become easier to perceive.
2. **Time vs. shape bias** — rotates lighting emphasis from distribution shape at `0` toward change over time at `1`.
3. **Contour detail** — selects a fixed contour interval on a logarithmic scale, ranging from approximately 3 to 24 bands at the reference peak.
4. **Surface contrast** (`relief`) — adjusts ambient light and shading contrast, ranging from a flat printed-map appearance to stronger three-dimensional relief.
5. **Presence** — adjusts overall terrain opacity without changing terrain structure or color separation.
6. **Color contrast** — adjusts perceptual separation between low-density slopes and the high-density ridge without changing geometry or opacity.
7. **Distribution extent** — adjusts the practical low-density cutoff and visible outer envelope without moving the ridge or changing the underlying density.

Keep these defaults in a dedicated, easy-to-find terrain configuration file, separate from unrelated chart configuration.

## App controls

Add a Distribution section beneath the metric controls in the left rail.

- Provide a `Bands / Terrain` style selector.
- Show the seven sliders when Terrain is selected and exactly one metric is active.
- Update the actual chart in real time as sliders move.
- Display the current numeric value beside each slider.
- Provide a **Copy settings** action that copies JSON matching `TerrainSettings`.
- Slider changes last for the current page session only. Reloading the app restores the source-controlled defaults.

Do not add reset, paste, save-as-default, synthetic scenario, tooltip, or legend controls in this version. To change the shipped defaults, copy settings from the running app and update the dedicated source configuration file.

## Redraw and performance strategy

Render the full visible terrain when any of these change:

- Baseline data
- Time range or horizontal scale
- Vertical scale
- Plot dimensions or device-pixel ratio
- Distribution style
- Terrain settings

Coalesce repeated slider input through `requestAnimationFrame`. Render at device-pixel resolution up to a device-pixel ratio of 2.

The first implementation intentionally uses full visible-window redraws. Its cost is bounded by plot resolution rather than observation-history length. Measure redraw performance before adding incremental caching.

If a 1000 by 500 CSS-pixel plot at device-pixel ratio 2 takes more than 50 ms at the 95th percentile during slider interaction, render a lower-resolution preview while dragging and perform a full-resolution render when interaction ends.

A streaming ring buffer is a future optimization for higher-frequency updates. It is outside this prototype's scope.

## Acceptance criteria

1. Bands remains the initial distribution style and retains its current behavior.
2. Switching between Bands and Terrain requires no data reload and preserves chart state.
3. A measured line near the density ridge reads as typical; a line on the outer slopes reads as unusual.
4. The same absolute deviation appears more consequential against a narrow distribution than against a broad distribution.
5. Narrow periods render as sharper and more densely contoured than broad periods without a per-column configuration change.
6. Expected-ridge movement remains visible while the ridge's shape and the measured line remain the dominant reading.
7. Terrain uses a sequential density palette and contains no health or severity encoding.
8. The terrain sits behind all measured-series and interaction elements and does not impede their use.
9. All seven sliders update the actual chart during interaction and display their current values.
10. Copy settings produces valid JSON that can replace the source-controlled `TerrainSettings` defaults.
11. Multi-metric mode hides distribution rendering and restores the selected style when one metric remains.
12. Existing chart behavior is unchanged when Terrain is inactive or its presence is zero.

## Deferred capabilities

- Predicted distributions and predicted series
- Empirical, skewed, and mixture density models
- Health or severity decoration
- End-user explanations, legends, and terrain-specific tooltips
- Interactive synthetic scenario data
- Persisted user settings
- Incremental ring-buffer rendering
