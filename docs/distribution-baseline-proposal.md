# Proposal: Replace Distribution Ribbon with Historical Baseline

## What This App Does

This is a network monitoring simulator that generates realistic WiFi metrics (coverage, throughput, capacity, etc.) for demo purposes. The backend simulates 6 access points using a driver-based model where three underlying physical drivers (client_load, rf_quality, infra_health) evolve via Ornstein-Uhlenbeck processes, and 7 metrics are derived from those drivers via a sensitivity matrix. Events (device crashes, interference, etc.) create perturbations that temporarily shift drivers, cascading to all metrics.

The frontend renders a D3.js timeseries chart with:
- A **line trace** showing actual metric values over time
- A **distribution ribbon** showing percentile bands (p1-p99, p5-p95, p10-p90, p25-p75) as nested gradient areas
- A **p50 expectation line** through the ribbon center
- Event markers on the timeline

The app runs at localhost:5012 (frontend) with backend on ports 5010 (WebSocket) and 5011 (HTTP API).

## Problems Being Solved

### Problem 1: Distribution ribbon doesn't represent what it should

**Current behavior**: The distribution ribbon is computed from the *same observations being displayed*. The backend buckets the queried observations into time windows (e.g., 1-hour buckets for a 24h view) and computes percentiles within each bucket. This means the ribbon shows "variance of data you're already looking at."

**What the user wants**: The ribbon should represent a **historical baseline** — "what this metric normally looks like at this time of day, based on weeks of history." The live trace then moves against this stable baseline, making anomalies visually obvious: when the trace goes outside the ribbon, something unusual is happening.

**Why the current approach fails visually**: When a perturbation event occurs (e.g., interference drops rf_quality by -0.25 for 300 seconds), observations within a single time bucket span from normal values to perturbed values. For coverage, this means a bucket might contain values from -53 dBm (normal) to -60 dBm (during interference), creating a distribution that's suddenly 7 dBm wide vs the normal ~1 dBm. The ribbon balloons out dramatically at perturbation timestamps, then shrinks back. The user describes this as "super wide distributions that shrink back down" — it's technically correct data but visually jarring and conceptually wrong (the ribbon should show what's *expected*, not what just happened).

### Problem 2: Distribution ribbon breaks during zoom/pan

**Current behavior**: When the user zooms or pans the chart, the distribution data is never recomputed. The method `recomputeDistributionSeries()` exists at `frontend/src/chart/ChartView.ts:683` but is **never called from anywhere**. The ribbon always renders the same ~19 points from the initial API fetch, regardless of the visible viewport.

**Visible symptoms**:
- Ribbon doesn't extend to cover the visible area after panning
- Sharp rectangular cutoffs where the ribbon data ends but the chart continues
- Ribbon shape doesn't adapt to zoom level

**Why the baseline approach fixes this too**: A historical baseline is inherently a 24-hour periodic pattern. It doesn't depend on the visible viewport — you just render the appropriate slice of the daily cycle for whatever time range is visible. No recomputation needed on zoom/pan.

## Investigation Details

### Current Data Flow (distribution)

```
1. User selects time range (e.g., "Last 24 Hours")
2. Frontend calls: GET /api/metrics/coverage?start=X&end=Y
3. Backend (http_api.py:94-106):
   - Queries all observations in range
   - Auto-selects bucket size (1h buckets for 24h range)
   - Calls metrics_store.compute_distribution_series(metric, start, end, bucket_size)
4. Backend (metrics_store.py:146-213):
   - Groups observations into time buckets
   - Computes np.percentile() for each bucket (needs ≥2 points)
   - Returns list of {timestamp, distribution} dicts
5. Frontend (main.ts) passes distribution_series to chart
6. Chart (ChartView.ts) stores in metricData.distributionSeries
7. Render (ChartView.ts:734+):
   - Passes distributionSeries to DistributionRibbonGenerator.update()
8. DistributionRibbonGenerator (DistributionRibbonGenerator.ts):
   - Creates D3 area paths for each percentile band
   - Uses curveMonotoneX for smooth interpolation
   - Renders p50 as a separate "expectation line"
```

### Current Distribution Sliding Window (live mode)

In `ChartView.ts:420-458`, during live updates, the code manually slides the distribution edges:
- Left edge moves to track the sliding window start
- Right edge extends to include new observations
- Uses the *last known* distribution values (flat projection)

This is a hack that projects stale distribution values forward. With a baseline approach, this entire block becomes unnecessary.

### Bootstrap Data Density

The backend generates ~30 days of tiered historical data on startup:

| Tier | Duration | Interval | Points/metric |
|------|----------|----------|---------------|
| 12-hour | 20 days | 43,200s | 40 |
| 6-hour | 6 days | 21,600s | 24 |
| 1-hour | 3 days | 3,600s | 72 |
| 15-min | 12 hours | 900s | 48 |
| 5-min | 3 hours | 300s | 36 |
| 1-min | 1 hour | 60s | 60 |
| Raw (10s) | 2 hours | 10s | 720 |
| **Total** | **~30 days** | | **~1,000** |

For 24 hourly baseline bins, that's **~40 observations per hour** — sufficient for rough percentiles (p10-p90 are reliable at n≥30). As the system runs and accumulates live data at 10s intervals, density improves rapidly (360 additional observations per hour of runtime).

### Key Files

| File | What it does |
|------|-------------|
| `backend/storage/metrics_store.py` | TinyFlux storage, `query_range()`, `compute_distribution_series()` |
| `backend/server/http_api.py` | HTTP endpoints, `/api/metrics/{metric}` |
| `backend/server/models.py` | Pydantic response models (Distribution, MetricResponse, etc.) |
| `backend/simulator/realistic_generator.py` | Driver-based metric generation (OU process + sensitivity matrix) |
| `backend/simulator/perturbations.py` | Perturbation templates and decay functions |
| `backend/simulator/config_enterprise.json` | Metric bounds, driver params, AP topology |
| `frontend/src/api/client.ts` | API client (`fetchMetricHistory()`) |
| `frontend/src/main.ts` | App orchestration, data loading, metric selection |
| `frontend/src/chart/ChartView.ts` | Chart orchestrator, owns metric data, distribution series, Y-domain |
| `frontend/src/chart/ChartCore.ts` | D3 scales, axes, zoom/pan handling |
| `frontend/src/chart/generators/DistributionRibbonGenerator.ts` | Renders percentile bands as D3 area paths |
| `frontend/src/chart/generators/LineGenerator.ts` | Renders metric trace line |
| `frontend/src/chart/types.ts` | TypeScript interfaces (Distribution, DistributionPoint, etc.) |

### Simulator Architecture (for context)

Three drivers (all 0-1 range) evolve via Ornstein-Uhlenbeck:
- **client_load**: Daily business-hours rhythm, weekend reduction, per-AP topology offsets
- **rf_quality**: Mostly stable, slight business-hours degradation, perturbation-driven
- **infra_health**: No daily pattern, event-driven only

Metrics are derived: `value = baseline + Σ(sensitivity × driver_deviation × metric_range)`

Coverage example: baseline=-55, range=40, rf_quality sensitivity=0.50. An interference event (rf_quality -0.25) shifts coverage by 0.50 × 0.25 × 40 = 5 dBm.

## Proposed Solution

### 1. New backend endpoint: `/api/metrics/{metric}/baseline`

Add a method to `metrics_store.py`:

```python
def compute_baseline_distribution(self, metric: str, lookback_days: int = 30) -> List[Dict]:
    """
    Compute hourly baseline distributions from historical data.

    Groups all observations by hour-of-day (0-23) across the lookback
    period and computes percentiles for each hour. This captures the
    daily rhythm (wider during business hours, narrower at night).

    Returns 24 distribution points, one per hour.
    """
    end = int(time.time())
    start = end - (lookback_days * 86400)
    observations = self.query_range(metric, start, end)

    # Group by hour-of-day
    hourly_bins = defaultdict(list)
    for obs in observations:
        hour = (obs["timestamp"] % 86400) // 3600
        hourly_bins[hour].append(obs["value"])

    # Compute percentiles per hour (same pattern as compute_distribution_series)
    result = []
    for hour in range(24):
        values = hourly_bins.get(hour, [])
        if len(values) >= 5:  # minimum for meaningful percentiles
            result.append({
                "hour": hour,
                "distribution": {
                    "p1": np.percentile(values, 1),
                    "p5": np.percentile(values, 5),
                    # ... same fields as existing Distribution model
                }
            })
    return result
```

Add endpoint in `http_api.py`:

```python
@app.get("/api/metrics/{metric}/baseline")
async def get_baseline(metric: str, lookback_days: int = 30):
    store = get_metrics_store()
    hourly = store.compute_baseline_distribution(metric, lookback_days)
    return {"metric": metric, "lookback_days": lookback_days, "hourly_distributions": hourly}
```

Add response model in `models.py`.

### 2. Frontend: Fetch baseline once per metric, cache it

In `api/client.ts`, add `fetchBaseline(metric, lookbackDays)`.

In `main.ts`, when a metric is selected:
1. Fetch baseline (one-time, cache the result)
2. Pass to chart via `chart.setBaseline(metricName, hourlyDistributions)`

### 3. Frontend: Map baseline onto visible time range

In `ChartView.ts`, add a `setBaseline()` method that stores 24 hourly distributions. In `render()`, generate distribution points for the visible time range by:

1. Get visible range `[startTs, endTs]`
2. For each hour boundary within the visible range, look up the corresponding hourly baseline distribution
3. Interpolate between adjacent hours for smooth rendering
4. Pass the resulting `DistributionPoint[]` to `DistributionRibbonGenerator.update()`

Since the baseline is a 24h cycle, this naturally tiles across any time range (1h, 24h, 7 days) and doesn't need recomputation on zoom/pan — just regenerate the mapping points from the cached baseline.

### 4. Remove old distribution plumbing

- Remove the sliding window distribution logic in `ChartView.ts:420-458`
- Remove the dead `recomputeDistributionSeries()` method
- Remove `distributionSeries` from MetricData interface
- Remove `currentDistribution` from MetricData (deprecated flat distribution)
- The `distribution_series` field in the API response can remain for backward compat but is no longer consumed by the ribbon

### What stays the same

- `DistributionRibbonGenerator.ts` — unchanged. It renders whatever `DistributionPoint[]` it receives.
- `LineGenerator.ts` — unchanged. The trace continues to show actual data.
- Backend observation storage and live streaming — unchanged.
- The existing distribution computation in `metrics_store.py` — kept but no longer used for the ribbon.

## Future Enhancements (not in this PR)

- **Weekday/weekend split**: The simulator already models weekends at 40% load. Storing two baseline profiles (weekday + weekend, 48 bins total) and selecting the right one per day visible in the chart would capture the weekly rhythm. Deferred because it requires the frontend to determine day-of-week for each visible day.
- **Adaptive density**: As the system accumulates live data over weeks, the baseline gets more accurate. Could add a "baseline freshness" indicator.
- **Baseline anomaly scoring**: Compute how far the current trace is from the baseline p50, normalized by the baseline width. This gives a quantitative anomaly score for the AI chat agent to use.

## Verification Plan

1. **Backend unit check**: `curl http://localhost:5011/api/metrics/coverage/baseline` — should return 24 hourly distributions with reasonable percentile values (coverage p50 should be around -54 to -55 dBm, wider during business hours 8-18)
2. **Visual check**: Open localhost:5012, select Coverage — ribbon should show a smooth daily pattern that's wider during business hours
3. **Zoom/pan test**: Disable live mode, zoom to 1h, pan across the day — ribbon should smoothly show the appropriate baseline slice without cutoffs or rectangles
4. **Anomaly visibility test**: In live mode, watch for perturbation events — the trace should spike outside the ribbon, making the anomaly visually obvious
5. **Multi-day test**: Select "Last 24 Hours" — the baseline pattern should tile correctly showing the daily rhythm
6. **Playwright MCP**: Use browser automation at localhost:5012 to systematically verify zoom, pan, and time range changes produce correct ribbon behavior
