# Juttle-Viz Implementation Guide

**Purpose**: Reference guide for implementing our TypeScript/D3 chart based on proven patterns from juttle-viz.

**Source**: `/docs/references/juttle-viz-source/`

---

## Overview

Juttle-viz is the reference implementation we're modernizing. It uses:
- **D3.js v3** (we'll use v7 with modern syntax)
- **jQuery + Backbone** (we'll replace with vanilla JS + TypeScript)
- **Underscore** (we'll use native ES6+ methods)

**What we're keeping**: Architecture patterns, visual design, D3 rendering techniques, interaction UX

**What we're modernizing**: Module system (ES6), type safety (TypeScript), no jQuery/Backbone dependency

---

## Architecture Patterns to Adopt

### 1. TimeBase Core (time-base.js)

**Location**: `src/lib/charts/time-base.js`

**Key Concepts**:

```javascript
// Layered SVG structure
svg
  └── g.chart-container (with margins transform)
      ├── g.axes (axes layer - drawn first, data on top)
      ├── defs (clip-path for overflow)
      ├── g.seriesOuter (with clip-path applied)
      │   └── g.seriesArea.data (actual series rendering area)
      └── [hover overlay]
```

**Margins**: 
```javascript
{
  top: 20,
  bottom: 100,  // Space for x-axis and context chart
  left: 20,
  right: 20
}
```

**Clip Path Pattern**:
- Create unique `clipPath` with ID per chart instance
- Apply to `seriesOuter` to prevent overflow
- Extend clip rect upward by `EVENT_MARKER_HEIGHT` (20px) for event markers

**Animation State Management**:
```javascript
// Smooth time sliding for live data
this.sliding = false;
this.current_range = null;
this.target_range = null;
this.transition_duration = 750; // ms
```

**Adopt**:
- ✅ Layered SVG structure (axes behind data)
- ✅ Clip path for overflow containment
- ✅ Margin convention with space for axes
- ✅ Animation state for smooth live updates
- ✅ Centralized transition duration management

---

### 2. SharedRange Pattern (shared-range.js)

**Location**: `src/lib/data-targets/shared-range.js`

**Purpose**: Single source of truth for time window across all series

**Interface**:
```javascript
SharedRange extends Backbone.Events {
  window: Duration,           // Fixed window size (if windowed)
  tfield: string,             // Time field name
  live: boolean,              // Live vs historical mode
  range: [Date, Date],        // Current visible range
  
  // Methods
  windowed() → boolean        // Has fixed window?
  set_window(milliseconds)    // Set window size
  set_range([from, to])       // Update range (triggers 'change:range')
  is_live() → boolean         // Is in live mode?
}
```

**Event System**:
```javascript
time_range.on('change:range', function(event, range) {
  // All series redraw when range changes
  self.target_range = range;
  self._slide(); // Smooth animation to new range
});
```

**Adopt**:
- ✅ Shared time range as event emitter
- ✅ `change:range` event pattern for synchronization
- ✅ Live vs windowed mode distinction
- **TypeScript**: Replace Backbone.Events with native EventTarget or custom EventEmitter

---

### 3. Generator Interface (line.js, event-markers.js)

**Location**: `src/lib/generators/`

**Standard Interface**:
```javascript
Generator {
  // Required lifecycle methods
  setScales(xScale, yScale)   // Receive D3 scales from chart
  update(payload, range)       // New data arrives
  redraw(range)                // Range changed, redraw existing data
  draw()                       // Internal: perform actual rendering
  
  // Visibility
  hide()                       // Set display: none
  show()                       // Remove display: none
  remove()                     // Destroy generator
  
  // Interaction
  hover_find(time) → point     // Find nearest point to time
  hover_on(point) → value      // Show hover indicator
  hover_off()                  // Hide hover indicator
  getTooltipContents(point, series) → DOM
  
  // Configuration
  set_color(color)
  set_duration(ms)             // Animation duration
  resize(width, height)        // Handle chart resize
}
```

**Adopt**:
- ✅ Standard generator interface (setScales, update, redraw, draw)
- ✅ Hover interaction pattern (find → on → off)
- ✅ Separation of update (new data) vs redraw (same data, new view)
- **TypeScript**: Define `Generator` interface with all required methods

---

### 4. Line Generator (line.js)

**Location**: `src/lib/generators/line.js`

**D3 Line Setup**:
```javascript
this.line = d3.svg.line()
  .x(function(d) { return self.xScale(d[self.xfield]); })
  .y(function(d) { return self.yScale(d[self.yfield]); })
  .defined(function(d) { 
    return d[self.yfield] !== INTERPOLATION_BREAK; 
  });
```

**Interpolation Breaks** (data gaps):
- Special sentinel value `'INTERPOLATION_BREAK'`
- Inserted into data array to break lines
- `.defined()` function filters them out → creates gaps

**Lonely Points**:
- Points surrounded by interpolation breaks (isolated)
- Rendered as small circles (r=2) even when `markerSize=0`
- Prevents completely invisible data

**Data Update Pattern**:
```javascript
update(payload, range) {
  // Keep points from previous range that are still visible
  // (smooth left-edge transitions)
  var oldPoints = this._getPreviousPointsToKeep(newData[0]);
  this.data = oldPoints.concat(newData);
  
  // Merge in interpolation breaks
  if (this._interpolationBreaks) {
    data = this.data.concat(this._interpolationBreaks);
    data = _.sortBy(data, this.xfield);
  }
  
  this.draw();
}
```

**Hover State**:
- Hover circle (r=4.5) with matching color
- Only drawn when `hover_point` is set
- Uses D3 data join pattern with single-item array

**Adopt**:
- ✅ D3 line generator with `.defined()` for gaps
- ✅ Interpolation break pattern for discontinuities
- ✅ Lonely point detection and rendering
- ✅ Previous point retention for smooth transitions
- ✅ Hover circle pattern (4.5px radius)
- **Note**: D3 v7 uses `d3.line()` not `d3.svg.line()`

---

### 5. Event Markers (event-markers.js)

**Location**: `src/lib/generators/event-markers.js`

**Visual Design**:
- Vertical line from top margin to bottom
- Icon at top (SVG path + FontAwesome character)
- Color: `#7EC7FF` (blue-light)
- Hover state: different color
- Line stroke: `$gray-medium`

**Icon Rendering**:
```javascript
// Pin/marker shape (SVG path)
var markerPath = 'M44,0C18.818,0,0,21.996,0,47.416C0,79.621,44,100,44,100s44-20.379,44-52.584C88,22.33,69.228,0,44,0z';

// FontAwesome icon inside (Unicode character)
icon.append('text')
  .attr('font-family', 'FontAwesome')
  .attr('font-size', '15px')
  .text(String.fromCharCode(parseInt(EventIcons[fullClass], 16)));
```

**Positioning**:
```javascript
function calculateTransform(d) {
  var x = self.xScale(d[self.xfield]);
  return 'translate(' + x + ',' + '-' + self.margin.top + ')';
}
```

**Tooltip**:
- Shows event title (field: `this.title`)
- Shows event message (field: `this.text`)
- Supports Markdown rendering with `marked` library

**Adopt**:
- ✅ Vertical line from margin to axis
- ✅ Icon at top with marker background
- ✅ Transform-based positioning
- ✅ Hover state with color change
- ✅ Tooltip with title + message
- **Modernize**: Use emoji or SVG icons instead of FontAwesome dependency

---

### 6. Adaptive Data Target (adaptive-data-target.js)

**Location**: `src/lib/data-targets/adaptive-data-target.js`

**Purpose**: Manages data buffering, windowing, and downsampling per series

**Key Features**:

1. **Historical Mode**: Buffer all incoming data
2. **Live Mode**: Maintain sliding window, discard old data
3. **Downsampling**: When points exceed `downsample_limit`, average by pixel buckets

**Find Points to Plot**:
```javascript
function findPointsToPlot(points, domain) {
  // Find first point >= domain[0], include one before
  // Find last point <= domain[1], include one after
  // Returns points slightly outside visible range for correct line angles
  return points.slice(firstPoint, lastPoint + 1);
}
```

**Windowing**:
```javascript
this.range.on('change:range', function(e, r) {
  // Filter data to only keep points >= range min
  self._filter(r[0]); 
});
```

**Interpolation Breaks**:
```javascript
addInterpolationBreak(time) {
  this._interpolationBreaks.push(time);
}
```

**Adopt**:
- ✅ Buffering pattern for historical data
- ✅ Windowing pattern for live data
- ✅ "One extra point on each side" optimization
- ✅ Interpolation break tracking
- ⚠️ Defer downsampling for prototype (ADR-010)

---

## Visual Design

### Color Palette (jut-color-scale.js)

**Location**: `src/lib/utils/jut-color-scale.js`

**Standard Colors**:
```javascript
[
  '#D87118',  // orange
  '#4E8DB8',  // blue
  '#FED66F',  // yellow
  '#79E0CB',  // aqua
  '#A4B946',  // green
  '#EB91C0',  // pink
  '#666E4C',  // olive
  '#8A406D',  // purple
  '#CC2200'   // red
]
```

**Usage**:
- D3 ordinal scale with this range
- Automatically cycles through colors for series
- Consistent, colorblind-friendly palette

**Adopt**:
- ✅ Use this exact color palette
- ✅ D3 ordinal scale for automatic color assignment

---

### Styling (_chart-main.scss)

**Location**: `src/lib/styles/_chart-main.scss`

**Key Styles**:

```scss
svg.jut-chart {
  shape-rendering: optimizeSpeed;  // Performance hint
  -webkit-transform: translate3D(0, 0, 0); // GPU acceleration
  
  path.line {
    fill: none;
    stroke-width: 1;
  }
  
  .axis {
    stroke-width: 1;
    
    path, line {
      shape-rendering: crispEdges;  // Sharp lines
      fill: none;
    }
    
    &.x path { stroke: $gray-lighter; stroke-width: 2; }
    &.y path { stroke: $gray-lighter; stroke-width: 2; }
  }
  
  .grid .tick line {
    stroke: $gray-lighter;
    stroke-width: 2;
  }
  
  .event-marker {
    stroke: $gray-medium;
    
    line.vertical-line { stroke: $gray-medium; }
    
    &.hover {
      stroke: $blue-light;
      line.vertical-line { stroke: $blue-light; }
    }
  }
  
  .series circle.hover {
    stroke: $yellow;
    stroke-width: 1;
  }
}
```

**Color Variables** (from SCSS):
- `$gray-lighter`: `#EBEBEB` (axes, grid)
- `$gray-medium`: `#999999` (event markers)
- `$gray-darker`: `#333333` (backgrounds)
- `$blue-light`: `#7EC7FF` (event icons, hover)
- `$yellow`: `#FED66F` (hover accents)

**Adopt**:
- ✅ `shape-rendering: optimizeSpeed` for chart
- ✅ `shape-rendering: crispEdges` for axes/grid
- ✅ Color scheme and variables
- ✅ Hover state patterns
- **TypeScript**: Convert to CSS or Tailwind classes

---

## D3 Patterns to Adopt

### 1. Data Join Pattern (from line.js)

```javascript
// Select → Data → Enter → Update → Exit
var path = this.series.selectAll('path.line');
path = path.data([data]); // Data is wrapped in array for single path

path.enter()
  .append('path')
    .attr('class', 'line')
    .style('stroke-width', this.width)
    .style('stroke', this.color);

path.exit().remove();

path.attr('d', this.line);  // Update path data
```

**Key**: Single path element for entire series (data wrapped in array)

### 2. Marker Circles Pattern

```javascript
var circle = this.series.selectAll('circle.data');

circle = circle.data(this.data, function(d) {
  return d[self.xfield];  // Key function prevents unnecessary redraws
});

circle.enter().append('circle')
  .attr('class', 'data');

circle
  .attr('cx', function(d) { return self.xScale(d[self.xfield]); })
  .attr('cy', function(d) { return self.yScale(d[self.yfield]); })
  .attr('r', this._attributes.markerSize)
  .attr('fill', this.color);

circle.exit().remove();
```

**Key**: Use time as key function for efficient updates

### 3. Transition Pattern (from event-markers.js)

```javascript
markerGroup.exit()
  .transition()
  .duration(self.duration / 2)
  .ease('linear')
  .attr('opacity', 0)
  .attr('transform', calculateTransform)
  .each('end', function(d) {
    d3.select(this).remove();
  });

markerGroup
  .attr('opacity', 1)
  .attr('transform', calculateTransform);
```

**Key**: Fade out on exit, update transform on all

### 4. Scale Setup Pattern

```javascript
setScales(xScale, yScale) {
  this.xScale = xScale;
  this.yScale = yScale;
  
  this.line
    .x(function(d) { return self.xScale(d[self.xfield]); })
    .y(function(d) { return self.yScale(d[self.yfield]); });
}
```

**Key**: Generators receive scales from chart core, configure line generator

---

## Interaction Patterns

### Hover Detection (from line.js)

```javascript
hover_find(targetTime) {
  // Binary search for closest time
  var closestIndex = seriesGeneratorUtils.getClosestIndex(
    targetTime, 
    _.pluck(this.data, this.xfield)
  );
  
  var closestPoint = this.data[closestIndex];
  
  // Check if within threshold (pixel distance)
  return seriesGeneratorUtils.checkIfPointWithinThreshold(
    targetTime, 
    closestPoint, 
    this.xScale, 
    this.xfield
  ) ? closestPoint : null;
}
```

**Threshold**: Only show hover if mouse is close enough (pixel-based)

### Hover Overlay (from time-base.js)

```javascript
setup_hover_events() {
  // Invisible rect over entire chart area to capture mouse
  var hoverRect = new HoverRect(this.el.node(), {
    width: this.width,
    height: this.height
  });
  
  hoverRect.on('mouseover', function(event) { ... });
  hoverRect.on('mousemove', function(mouse) {
    // Convert pixel x to time using scale
    var t = self.xScale.invert(mouse.x);
    
    // Ask each generator for closest point
    _.each(self.series, function(s) {
      var point = s.generator.hover_find(t);
      if (point) {
        s.generator.hover_on(point);
      }
    });
  });
  hoverRect.on('mouseout', function(event) { ... });
}
```

**Pattern**: Invisible overlay rect → scale.invert(x) → hover_find → hover_on

---

## Live Sliding Animation (from time-base.js)

**The `_slide()` method** handles smooth time window transitions:

```javascript
_slide() {
  if (this.sliding) { return; }  // Already animating
  
  this.sliding = true;
  this.current_range = this.current_range || this.target_range;
  
  // Transform seriesArea to create sliding effect
  // New data enters from right, old exits left
  
  // Animate transform over transition_duration
  // When complete, reset transform and update scales
  
  this.sliding = false;
}
```

**Adopt**:
- ✅ Transform-based panning for smooth animation
- ✅ Queue target range if animation in progress
- ✅ Reset and update scales after animation completes

---

## TypeScript Modernization Plan

### Replace Backbone.Events

**Old** (Backbone):
```javascript
var TimeBase = function() {
  _.extend(this, Backbone.Events);
}
time_range.on('change:range', callback);
time_range.trigger('change:range', range);
```

**New** (TypeScript):
```typescript
class SharedRange extends EventTarget {
  setRange(range: [Date, Date]) {
    this.range = range;
    this.dispatchEvent(new CustomEvent('change:range', { 
      detail: { range } 
    }));
  }
}

timeRange.addEventListener('change:range', (e) => {
  const range = e.detail.range;
});
```

### Replace jQuery

**Old**:
```javascript
var wrapper = $('<div/>');
wrapper.addClass('jut-chart-wrapper');
$(element).append(wrapper);
```

**New**:
```typescript
const wrapper = document.createElement('div');
wrapper.className = 'jut-chart-wrapper';
element.appendChild(wrapper);
```

### Replace Underscore

**Old**:
```javascript
_.extend(this, options);
_.pluck(this.data, this.xfield);
_.sortBy(data, function(d) { return d[self.xfield]; });
```

**New**:
```typescript
Object.assign(this, options);
this.data.map(d => d[this.xfield]);
data.sort((a, b) => a[this.xfield] - b[this.xfield]);
```

---

## Implementation Checklist

When building each component, reference juttle-viz for:

### ChartCore
- [ ] Layered SVG structure from `time-base.js` lines 53-91
- [ ] Clip path pattern lines 71-78
- [ ] Margin convention lines 39-44
- [ ] Hover overlay setup lines 196-200

### SharedRange
- [ ] Event emitter pattern from `shared-range.js`
- [ ] Live vs windowed modes lines 15-17, 33-35
- [ ] Range change event lines 28-30

### Line Generator
- [ ] D3 line generator setup from `line.js` lines 47-51
- [ ] Interpolation break pattern lines 6-27, 186-191
- [ ] Lonely point detection lines 8-28, 246-268
- [ ] Hover circle pattern lines 288-307
- [ ] Previous points retention lines 157-171

### EventMarkers Generator
- [ ] Icon + line structure from `event-markers.js` lines 156-189
- [ ] Transform positioning lines 131-134
- [ ] Hover state lines 79-87, 159-164
- [ ] Tooltip format lines 89-104

### DataTarget
- [ ] Buffering pattern from `adaptive-data-target.js` lines 72-73
- [ ] Find points to plot optimization lines 35-56
- [ ] Interpolation break tracking lines 119-121

### Styling
- [ ] Color palette from `jut-color-scale.js` lines 7-44
- [ ] CSS patterns from `_chart-main.scss` lines 1-546
- [ ] Shape rendering hints lines 2-3
- [ ] Axis styling lines 70-131
- [ ] Event marker styling lines 140-165

---

## Key Differences from Original

### What We're Adding
- **Distribution Ribbon** - Not in juttle-viz, new feature
- **TypeScript types** - Full type safety
- **Modern D3 (v7)** - Updated API syntax
- **Percentile computation** - From historical queries (ADR-001)

### What We're Removing (for Prototype)
- **Context chart** - Defer brush navigator (Phase 2)
- **Dual Y-axis** - Single metric at a time (Phase 1)
- **Downsampling** - Skip for prototype (ADR-010)
- **Time overlay** - Defer comparison mode (Phase 2)
- **Series limit/filter** - Single metric (Phase 1)

---

## Quick Reference: File Locations

| Component | Juttle-Viz Source | Our Implementation |
|-----------|-------------------|-------------------|
| Chart Core | `src/lib/charts/time-base.js` | `frontend/src/chart/ChartCore.ts` |
| Line Generator | `src/lib/generators/line.js` | `frontend/src/chart/generators/Line.ts` |
| Event Markers | `src/lib/generators/event-markers.js` | `frontend/src/chart/generators/EventMarkers.ts` |
| SharedRange | `src/lib/data-targets/shared-range.js` | `frontend/src/chart/SharedRange.ts` |
| DataTarget | `src/lib/data-targets/adaptive-data-target.js` | `frontend/src/chart/DataTarget.ts` |
| Color Scale | `src/lib/utils/jut-color-scale.js` | Use same colors in `types.ts` |
| Styles | `src/lib/styles/_chart-main.scss` | `frontend/src/style.css` |

---

## Next Steps

1. Review this guide before implementing each component
2. Keep juttle-viz source open for reference while coding
3. Adopt D3 patterns directly, modernize syntax
4. Preserve visual design (colors, spacing, interaction)
5. Add TypeScript types as you go
6. Test against juttle-viz behavior for consistency
