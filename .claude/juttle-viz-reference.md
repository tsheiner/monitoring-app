# Juttle-Viz Library Reference

Tim Sheiner designed this charting library for the Juttle Engine. This document provides quick reference for rendering timeseries data.

Repository: https://github.com/juttle/juttle-viz
Documentation: https://juttle.github.io/juttle-viz/

## Technology Stack

- D3.js (rendering)
- jQuery (DOM manipulation)
- Underscore.js (utilities)
- Backbone.js (events)

---

## Timechart Quick Start

```javascript
var TimeChartView = require('juttle-viz/src/views/timechart');

var chart = new TimeChartView({
  juttleEnv: { now: new Date() },
  params: {
    title: 'My Chart',
    timeField: 'time',
    valueField: 'value'
  }
});

// Push data points
chart.consume([
  { time: new Date('2024-01-01T00:00:00Z'), value: 42, host: 'server1' },
  { time: new Date('2024-01-01T00:01:00Z'), value: 45, host: 'server1' }
]);

// Signal end of stream (enables context chart)
chart.consume_eof();
```

---

## Data Format

Points are plain objects with:
- **Time field**: Date object (default field name: `time`)
- **Value field**: Number (default field name: `value`, auto-detected if omitted)
- **Grouping fields**: Any non-numeric fields become series keys

```javascript
// Single series (no grouping fields)
{ time: Date, value: 100 }

// Multiple series (grouped by 'host')
{ time: Date, value: 100, host: 'server1' }
{ time: Date, value: 85, host: 'server2' }

// Explicit keyField grouping
{ time: Date, cpu: 45, metric_name: 'cpu_usage' }  // keyField: 'metric_name'
```

---

## Configuration Options

### Essential Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeField` | string | `'time'` | Field containing Date objects |
| `valueField` | string | auto-detect | Field containing numeric values |
| `keyField` | string | undefined | Explicit field for series grouping |
| `title` | string | undefined | Chart title |

### Display Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `duration` | moment.duration | undefined | Fixed time window to display |
| `interval` | moment.duration | undefined | Max gap before breaking line |
| `markerSize` | number | `0` | Circle diameter at data points |
| `downsample` | boolean | `true` | Average points when too dense |
| `seriesLimit` | number | `20` | Max visible series |
| `overlayTime` | boolean | `false` | Compare multiple time periods |

### Series Configuration

```javascript
params: {
  series: [
    {
      name: 'cpu',           // matches keyField value
      label: 'CPU Usage',    // display name
      color: '#ff0000',      // CSS color
      geom: 'line',          // 'line' or 'bars'
      yScale: 'primary',     // 'primary' or 'secondary'
      width: 2               // stroke width
    }
  ]
}
```

### Y-Axis Configuration

```javascript
params: {
  yScales: {
    primary: {
      label: 'Requests/sec',
      minValue: 0,           // or 'auto'
      maxValue: 'auto',
      displayOnAxis: 'left', // 'left' or 'right'
      tickFormat: '.2f'      // d3 format string
    },
    secondary: {
      label: 'Latency (ms)',
      displayOnAxis: 'right'
    }
  }
}
```

### X-Axis Configuration

```javascript
params: {
  xScale: {
    label: 'Time',
    tickFormat: '%H:%M:%S'   // d3 time format
  }
}
```

---

## Architecture Overview

```
TimeChartView (views/timechart.js)
    │
    ├── TimeBase (lib/charts/time-base.js)
    │       │
    │       ├── Generators (line.js, time-bars.js)
    │       │       └── D3 path/rect rendering
    │       │
    │       ├── DataTargets (adaptive-data-target.js)
    │       │       └── Buffering, downsampling, range tracking
    │       │
    │       └── SharedRange
    │               └── Time synchronization across series
    │
    ├── Legend (lib/generators/legend.js)
    ├── ContextChart (lib/components/context-chart.js)
    └── Hover (lib/components/hover.js)
```

---

## Key Methods

### TimeChartView

```javascript
// Push data batch
chart.consume(points: Object[])

// Signal stream end (enables context chart for historical data)
chart.consume_eof()

// Resize chart
chart.setDimensions(key, width, height)

// Extend visible time range
chart.extendTimeRange(date: Date)

// Cleanup
chart.destroy()
```

### Internal (TimeBase)

```javascript
// Add custom scale
chart.chart.add_scale(isXScale, name, d3Scale, options)

// Show/hide series
chart.chart.hide_series(seriesId)
chart.chart.show_series(seriesId)

// Toggle animations
chart.chart.toggleAnimations(enabled: boolean)
```

---

## Series Auto-Detection

When `keyField` is undefined, the library groups data by **all non-numeric, non-time, non-value fields**:

```javascript
// These create TWO series (grouped by host + region combination)
{ time: t1, value: 10, host: 'a', region: 'us' }
{ time: t2, value: 20, host: 'a', region: 'eu' }
```

Series labels are auto-generated as `"field1: value1, field2: value2"`.

---

## Dual Y-Axis Example

```javascript
var chart = new TimeChartView({
  juttleEnv: { now: new Date() },
  params: {
    keyField: 'metric',
    series: [
      { name: 'requests', yScale: 'primary', color: 'blue' },
      { name: 'latency', yScale: 'secondary', color: 'red' }
    ],
    yScales: {
      primary: { label: 'Requests', displayOnAxis: 'left' },
      secondary: { label: 'Latency (ms)', displayOnAxis: 'right' }
    }
  }
});

chart.consume([
  { time: t, value: 1000, metric: 'requests' },
  { time: t, value: 45, metric: 'latency' }
]);
```

---

## Live vs Historical Mode

- **Live mode** (`_live: true`): Smooth sliding animations, no context chart
- **Historical mode**: Context chart appears after `consume_eof()`, brush-based zooming

The `juttleEnv.now` parameter establishes the reference time for live streaming.

---

## Downsampling Behavior

When `downsample: true` (default):
- Activates when point density exceeds 1 point per 2 pixels
- Averages values within each pixel bucket
- Triggers warning message to user
- Disabled by setting `downsample: false`

---

## Event System

TimeBase emits Backbone events:

```javascript
chart.chart.on('mouseover', function(event) { ... });
chart.chart.on('mouseout', function(event) { ... });
chart.chart.on('mousemove', function(mouse) { ... });
chart.chart.on('click', function(mouse) { ... });
chart.chart.on('update', function() { ... });
chart.chart.on('updatetime', function({ from, to }) { ... });
```

---

## Common Patterns

### Fixed Time Window (Last 5 Minutes)

```javascript
params: {
  duration: moment.duration(5, 'minutes')
}
```

### Gap Detection (Break Lines After 1 Minute Gap)

```javascript
params: {
  interval: moment.duration(1, 'minute')
}
```

### Styled Series with Custom Colors

```javascript
params: {
  keyField: 'status',
  series: [
    { name: 'success', color: '#00aa00', label: 'Success' },
    { name: 'error', color: '#ff0000', label: 'Errors' }
  ]
}
```

### Bar Chart for Discrete Intervals

```javascript
params: {
  series: [{ geom: 'bars' }]
}
```
