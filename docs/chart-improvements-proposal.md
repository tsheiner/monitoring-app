# Chart Improvements Proposal

## Current Issues Fixed

### 1. ✅ Chart Growth Behavior
**Changed**: Chart now implements proper left-to-right growth:
- **Growth Phase**: Starts at left edge, line grows rightward as data arrives
- **Steady State**: Once duration is filled, becomes sliding window (right edge = now)
- **Duration-driven**: User selects how much history to show (1hr, 6hr, 24hr)

### 2. ✅ Console Logging
Added detailed logging to debug the "2 observations" issue:
- Logs when fetching data
- Logs observations received
- Logs range changes
- Logs rendering

## Aggregation Strategy Proposal

### Current Problem
- Backend generates 1 observation every 10 seconds per metric
- For 24 hours: 8,640 observations per metric
- Rendering this many points is inefficient and unnecessary

### Proposed Solution: Multi-Level Aggregation

```typescript
interface AggregationLevel {
  timeRange: [number, number];  // seconds from now
  bucketSize: number;            // seconds per bucket
  aggregation: 'raw' | 'avg' | 'min' | 'max' | 'p50';
}

const AGGREGATION_STRATEGY: AggregationLevel[] = [
  // Last minute: show all raw data
  {
    timeRange: [0, 60],
    bucketSize: 10,  // raw 10-second data
    aggregation: 'raw'
  },
  
  // 1 minute to 1 hour: aggregate to 1-minute buckets
  {
    timeRange: [60, 3600],
    bucketSize: 60,
    aggregation: 'avg'  // average of ~6 points
  },
  
  // 1 hour to 4 hours: aggregate to 5-minute buckets
  {
    timeRange: [3600, 14400],
    bucketSize: 300,
    aggregation: 'avg'  // average of ~30 points
  },
  
  // 4 hours to 24 hours: aggregate to 15-minute buckets
  {
    timeRange: [14400, 86400],
    bucketSize: 900,
    aggregation: 'avg'  // average of ~90 points
  },
  
  // Beyond 24 hours: aggregate to 1-hour buckets
  {
    timeRange: [86400, Infinity],
    bucketSize: 3600,
    aggregation: 'avg'
  }
];
```

### Point Count Estimate

| View Duration | Points Shown | Reasoning |
|---------------|-------------|-----------|
| Last 1 hour | ~66 points | 6 (raw) + 60 (1min avg) |
| Last 6 hours | ~132 points | 6 + 60 + 66 (5min avg) |
| Last 24 hours | ~226 points | 6 + 60 + 66 + 94 (15min avg) |

This keeps the chart responsive while showing appropriate detail.

### Implementation Approach

**Option A: Server-side aggregation (recommended)**
- Backend API accepts `aggregation` parameter
- Server computes buckets before sending
- Frontend just renders what it receives
- More efficient (less data over wire)

**Option B: Client-side aggregation**
- Fetch raw data, aggregate in browser
- More flexible but sends more data
- Good for prototype, not production

**Recommendation**: Start with Option A for clean architecture.

## Juttle-viz Feature Comparison

### Currently Implemented ✅

| Feature | Status | Notes |
|---------|--------|-------|
| Basic timechart | ✅ | Working |
| Duration-based display | ✅ | **Just fixed!** |
| Line rendering | ✅ | Single series |
| Event overlay | ✅ | Vertical markers with tooltips |
| Custom colors | ✅ | From configuration |
| Y-axis auto-scaling | ✅ | Based on data range |

### Missing (Priority Order)

#### Priority 1: Core Functionality

| Feature | Effort | Impact | Implementation Notes |
|---------|--------|--------|---------------------|
| **Downsampling** | Medium | High | Critical for performance. Implement aggregation strategy above. |
| **Interval gap detection** | Low | Medium | Break lines when points are >N seconds apart. Prevents misleading interpolation. |
| **Multiple series** | Medium | High | Support multiple metrics on one chart. Need series[] config. |
| **valueField/timeField config** | Low | Medium | Currently hardcoded to 'value' and 'timestamp'. Should be configurable. |

#### Priority 2: Enhanced Visualization

| Feature | Effort | Impact | Implementation Notes |
|---------|--------|--------|---------------------|
| **Dual Y-axis** | Medium | Medium | Primary (left) + secondary (right). For metrics with different scales. |
| **Series configuration** | Medium | High | Per-series: color, label, yScale, geom (line/bars), width. |
| **Bars geometry** | Low | Low | Render series as bars instead of lines. Good for discrete events. |
| **Marker size control** | Low | Low | Circle diameter for each point. Defaults to 0 (line only). |

#### Priority 3: Time Comparison

| Feature | Effort | Impact | Implementation Notes |
|---------|--------|--------|---------------------|
| **overlayTime** | High | Medium | Compare this week vs last week. Each period gets its own X-scale. Complex! |
| **Context chart with brush** | High | Medium | Miniature view below main chart for range selection. |

#### Priority 4: Advanced Features

| Feature | Effort | Impact | Implementation Notes |
|---------|--------|--------|---------------------|
| **Custom tick formatting** | Low | Low | D3 format strings for axes. |
| **Min/max value constraints** | Low | Low | Force Y-axis range. |
| **Axis labels** | Low | Low | Custom labels for X/Y axes. |
| **Hover interactions** | Medium | Medium | Crosshair, value display on hover. |

### Recommended Implementation Order

**Phase 1 (This Week)**: Fix foundation
1. ✅ Fix chart growth behavior (DONE)
2. Debug "2 observations" issue (check browser console)
3. Implement server-side aggregation
4. Add interval gap detection

**Phase 2 (Next Week)**: Core features
1. Multiple series support
2. Series configuration (colors, labels)
3. Dual Y-axis
4. Downsampling warning UI

**Phase 3 (Later)**: Advanced features
1. overlayTime for period comparison
2. Context chart with brush
3. Hover interactions
4. Export functionality

## Proposed API Changes

### Current API
```typescript
GET /api/metrics/{metric}?start={ts}&end={ts}
```

### Proposed Enhanced API
```typescript
GET /api/metrics/{metric}?start={ts}&end={ts}&aggregation={bucket_seconds}

Response:
{
  "metric": "time_to_connect",
  "start": 1234567890,
  "end": 1234571490,
  "aggregation": 60,  // bucket size in seconds
  "observations": [
    {"timestamp": 1234567890, "value": 45, "count": 6},  // avg of 6 raw points
    ...
  ],
  "distribution": { ... }
}
```

The `count` field indicates how many raw points were averaged into this bucket.

## Next Steps

1. **Debug current issue**: Check browser console for the "2 observations" log messages
2. **Test fixed behavior**: Restart frontend (`npm run dev`) and see if chart grows left→right
3. **Implement aggregation**: Add server-side aggregation to backend API
4. **Add interval gaps**: Break lines when points are >60 seconds apart

Would you like me to:
- A) Debug the "2 observations" issue first?
- B) Implement the aggregation strategy?
- C) Add more juttle-viz features (which ones)?
