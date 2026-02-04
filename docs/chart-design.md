# Timeseries Chart Rebuild Design

This document captures the architecture, features, and patterns from juttle-viz that we want to preserve, along with enhancements for the rebuild.

---

## Design Goals

1. **LLM-optimized generation** - Clean object model that enables an LLM to generate complete chart configurations
2. **Preserve proven patterns** - Leverage architectural decisions from juttle-viz that solve real problems
3. **Modern stack** - No legacy dependencies (jQuery, Backbone, old D3)
4. **Distribution visualization** - New capability for showing uncertainty/variance over time

---

## Architecture Patterns to Preserve

### 1. Layered Component Architecture

```
ChartView (orchestration)
    │
    ├── ChartCore (scales, axes, time range, animations)
    │
    ├── Generators (pluggable renderers)
    │       ├── Line
    │       ├── Bars
    │       ├── DistributionRibbon (NEW)
    │       └── EventMarkers
    │
    ├── DataTargets (data management per series)
    │       └── Handles buffering, downsampling, range tracking
    │
    └── Components (UI elements)
            ├── Legend
            ├── ContextChart (brush navigator)
            ├── Hover
            └── TimeRangeDisplay
```

**Why preserve this:** Separation of concerns allows swapping renderers, independent data management per series, and composable UI.

### 2. SharedRange Pattern

All series subscribe to a shared time range object. When the range changes, all series update in sync.

```
SharedRange
    ├── emits 'change:range' events
    ├── tracks [from, to] bounds
    └── supports live mode (sliding window) vs historical mode
```

**Why preserve this:** Critical for synchronized multi-series display, zoom/pan, and the overlay feature.

### 3. DataTarget Abstraction

Each series has a DataTarget that:
- Buffers incoming points
- Tracks Y-domain (min/max) for scale calculation
- Handles downsampling when density exceeds threshold
- Manages interpolation breaks (gaps in data)

```
DataTarget
    ├── push(points[]) - add new data
    ├── yDomain - current [min, max] of values
    ├── downsample_limit - points per pixel threshold
    └── addInterpolationBreak(date) - mark gap in continuity
```

**Why preserve this:** Encapsulates data complexity away from rendering. Enables efficient updates.

### 4. Generator Interface

Generators are pluggable renderers with a consistent interface:

```
Generator
    ├── setScales(xScale, yScale)
    ├── update(data, range)
    ├── redraw(range)
    ├── show() / hide()
    ├── set_color(color)
    └── resize(width, height)
```

**Why preserve this:** New visualization types (like DistributionRibbon) plug in cleanly.

### 5. Automatic Series Detection

When no explicit `keyField` is provided, series are created by grouping on all non-numeric, non-time, non-value fields.

```javascript
// These become two series automatically
{ time: t, value: 10, host: 'a', region: 'us' }
{ time: t, value: 20, host: 'b', region: 'us' }
```

**Why preserve this:** Reduces configuration burden. Data shape implies series structure.

### 6. Animated Time Sliding

For live data, the chart smoothly pans the X-axis:
- New range is set as target
- Current view animates toward target
- If new data arrives during animation, it queues and continues

**Why preserve this:** Smooth UX for real-time monitoring.

---

## Features to Preserve

### Range Selection & Interaction

| Feature | Description |
|---------|-------------|
| **Context Chart** | Miniature view below main chart with brush for selecting time range |
| **Brush Selection** | Click-drag to select a time window |
| **Zoom Sync** | Main chart zooms to match brush selection |
| **Live vs Historical** | Context chart only appears after stream ends (historical mode) |

### Time Overlay Mode (`overlayTime`)

Enables comparing the same metric across multiple time periods:
- Each time period gets its own X-scale anchored to period start
- Series are visually stacked with distinct colors
- Labels show relative time ("2 hours ago", "1 day ago")
- Oldest periods fade, newest are prominent

**Implementation pattern:**
- Create unique X-scale per time period
- SharedRange per overlay, mapped to common visual range
- Color scale updates as new periods arrive
- Series ordering by recency

### Event Markers

Overlay discrete events on the timeseries:
- Vertical markers at event timestamps
- Configurable marker height, color, shape
- Hover reveals event details
- Can combine with `view events` in juttle

### Dual Y-Axis

- Primary axis (left) and secondary axis (right)
- Series assigned to either scale
- Independent min/max, tick formatting
- Useful for metrics with different units (requests vs latency)

### Series Management

| Feature | Description |
|---------|-------------|
| **Series Limit** | Cap visible series (default 20), hide excess |
| **Series Filter** | Search/filter series by key values |
| **Show/Hide** | Toggle individual series visibility |
| **Legend** | Interactive legend with color, label, current value |

### Interval Gap Detection

When points are farther apart than `interval`, break the line:
- Prevents misleading interpolation across data gaps
- Configurable threshold
- Creates visual break in continuity

### Downsampling

When point density exceeds 1 point per 2 pixels:
- Average values within each pixel bucket
- Emit warning to user
- Preserve visual fidelity while maintaining performance
- Configurable via `downsample: true/false`

---

## New Feature: Distribution Ribbon

### Concept

Visualize statistical distributions over time as a continuous gradient field around a central tendency line.

### Visual Representation

```
        ┌─ faint outer edge (tail of distribution)
        │
    ════╬════  ← gradient fades perpendicular to trace
        │
        └─ dark center (central tendency)
```

- **Central trace**: Configurable statistic (mean, median, p50, mode)
- **Gradient field**: Extends perpendicular to trace at each time point
- **Opacity mapping**: Probability density → alpha channel
- **Smooth interpolation**: Distribution shape flows along time axis

### Data Model

Three encoding options with different expressiveness:

#### Option A: Density Buckets (Full Expressiveness)

Supports **multimodal, skewed, and arbitrary distribution shapes**.

```javascript
{
  time: Date,
  center: number,              // central tendency for the trace line
  density: [
    { value: 10, weight: 0.3 },   // first mode
    { value: 15, weight: 0.1 },   // valley
    { value: 25, weight: 0.4 },   // second mode (bimodal!)
    { value: 30, weight: 0.2 }
  ]
}
```

The `weight` at each `value` maps to opacity. Multiple peaks render as multiple high-opacity bands.

#### Option B: Percentiles (Compact, Unimodal Only)

Simpler data format but **cannot represent multimodal** distributions. The visualization interpolates smooth gradients between percentile boundaries.

```javascript
{
  time: Date,
  p50: number,                 // median (center trace)
  p5: number,
  p25: number,
  p75: number,
  p95: number
}
```

#### Option C: Parametric (Assumed Shape)

Most compact but **assumes known distribution family** (e.g., Gaussian).

```javascript
{
  time: Date,
  mean: number,
  stddev: number,
  // Optional: skewness, kurtosis for more nuance
}
```

### Multimodal Rendering

For density bucket format with multiple modes:

```
        ┌─ second mode (high opacity band)
        │
    ────┼──── ← low opacity valley between modes
        │
        └─ first mode (high opacity band)
        │
    ════╬════ ← center trace (may be between modes)
```

The gradient is no longer symmetric - it follows the actual density profile at each time point.
```

### Rendering Approach

1. At each time point, construct vertical density profile
2. Map density values to opacity (configurable transfer function)
3. Interpolate between adjacent time points for smooth field
4. Render as gradient mesh or stacked translucent paths
5. Draw central tendency line on top (dark, crisp)

### Configuration

```javascript
{
  distribution: {
    center: 'median',           // or 'mean', 'p50', custom field
    spread: 'percentiles',      // or 'stddev', 'histogram'
    percentileFields: ['p5', 'p25', 'p75', 'p95'],
    colorScheme: 'blue',        // base color for gradient
    opacityRange: [0.05, 0.8],  // [tail, center] opacity
    symmetric: false            // assume symmetric around center?
  }
}
```

### Interaction

- Hover shows distribution details at that time point
- Can combine with discrete line traces
- Respects zoom/pan and time overlay
- Legend indicates what central tendency represents

---

## Object Model (LLM-Optimized)

Design the configuration schema to be:
1. **Declarative** - Describe what, not how
2. **Composable** - Features combine orthogonally
3. **Defaulted** - Minimal config for common cases
4. **Validated** - Schema catches errors before render

### Proposed Configuration Schema

```javascript
{
  // Data field mapping
  timeField: 'time',
  valueField: 'value',        // auto-detect if omitted
  keyField: 'metric',         // explicit series grouping

  // Display
  title: 'System Metrics',
  duration: '5m',             // or moment duration

  // Series definitions (optional, auto-detect if omitted)
  series: [
    {
      name: 'cpu',
      label: 'CPU Usage',
      color: '#3b82f6',
      type: 'line',           // 'line', 'bars', 'distribution'
      yAxis: 'primary',

      // For distribution type
      distribution: {
        center: 'p50',
        percentiles: ['p5', 'p25', 'p75', 'p95']
      }
    }
  ],

  // Axes
  yAxes: {
    primary: { label: 'Percent', min: 0, max: 100 },
    secondary: { label: 'Count', position: 'right' }
  },

  // Features
  features: {
    contextChart: true,       // brush navigator
    legend: true,
    hover: true,
    downsample: true,
    animate: true
  },

  // Time overlay comparison
  overlay: {
    enabled: false,
    periods: ['1h', '1d', '1w']  // compare against
  },

  // Events
  events: {
    enabled: false,
    field: 'event_type',
    colorMap: { deploy: 'blue', alert: 'red' }
  },

  // Behavior
  interval: '1m',             // gap threshold
  seriesLimit: 20,
  markerSize: 0
}
```

---

## Implementation Considerations

### Modern Stack Candidates

| Concern | Options |
|---------|---------|
| Rendering | D3 v7, Canvas API, WebGL (for large datasets) |
| Reactivity | Vanilla events, Signals, or framework integration |
| State | Simple class-based, or reactive stores |
| Types | TypeScript for schema validation |

### Performance Patterns

1. **Virtualized rendering** - Only draw visible portion
2. **Requestanimationframe batching** - Coalesce rapid updates
3. **Web Workers** - Offload downsampling/aggregation
4. **Canvas fallback** - For very large point counts

### LLM Generation Optimization

1. **Single configuration object** - One JSON blob describes entire chart
2. **Sensible defaults** - Minimal config produces useful chart
3. **Clear field naming** - Self-documenting property names
4. **Consistent patterns** - Similar features configured similarly
5. **Error messages** - Schema validation with helpful messages

---

## Open Questions

1. **Distribution data format** - Percentiles vs histogram buckets vs parametric?
2. **Overlay UX** - How to select which time periods to compare?
3. **Event interaction** - Click event marker to drill down?
4. **Export** - SVG, PNG, data export?
5. **Responsive** - How to handle resize/mobile?
6. **Accessibility** - Screen reader support, keyboard nav?

---

## Next Steps

1. Define TypeScript interfaces for configuration schema
2. Prototype core chart with line generator
3. Add distribution ribbon generator
4. Implement range selection and overlay
5. Add event markers
6. Build context chart with brush
