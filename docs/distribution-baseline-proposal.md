# Proposal: Replace Distribution Ribbon with Historical Baseline

## What This App Does

This is a network monitoring simulator that generates realistic WiFi metrics (coverage, throughput, capacity, etc.) for demo purposes. The backend simulates 6 access points using a driver-based model where three underlying physical drivers (client_load, rf_quality, infra_health) evolve via Ornstein-Uhlenbeck processes, and 7 metrics are derived from those drivers via a sensitivity matrix. Events (device crashes, interference, etc.) create perturbations that temporarily shift drivers, cascading to all metrics.

The frontend renders a D3.js timeseries chart with:
- A **line trace** showing actual metric values over time
- A **distribution ribbon** showing percentile bands (p1-p99, p5-p95, p10-p90, p25-p75) as nested gradient areas
- A **p50 expectation line** through the ribbon center
- Event markers on the timeline

The app runs at localhost:5012 (frontend) with backend on ports 5010 (WebSocket) and 5011 (HTTP API).

### Design Intent

The baseline represents "what this metric normally looks like at this time of day" as produced by the simulator's OU process and daily rhythms. Perturbation events are the anomalies — when they fire, the live trace should visibly break out of the baseline ribbon, making the disruption obvious. Over time the simulator will improve at mimicking real network behavior (different topologies, structured incident scenarios like DoS attacks), but the baseline always comes from the simulator's own historical data.

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

| Tier | Duration | Interval | Points/metric/AP |
|------|----------|----------|------------------|
| 12-hour | 20 days | 43,200s | 40 |
| 6-hour | 6 days | 21,600s | 24 |
| 1-hour | 3 days | 3,600s | 72 |
| 15-min | 12 hours | 900s | 48 |
| 5-min | 3 hours | 300s | 36 |
| 1-min | 1 hour | 60s | 60 |
| Raw (10s) | 2 hours | 10s | 720 |
| **Total** | **~30 days** | | **~1,000** |

**Per-hour-of-day density (corrected estimate):** The tiered structure means observations are not uniformly distributed across hours-of-day. Coarse tiers (12-hour, 6-hour) contribute only ~1-2 observations per hour-of-day across their full duration. The 1-hour tier adds ~3 per hour-of-day. Sub-hour tiers cover only the most recent hours and contribute to only ~12 of the 24 bins. **Realistic estimate at startup: ~5-8 observations per hour-of-day per AP** — below the ideal threshold for stable percentiles.

This sparsity is handled by the cold-start fallback strategy described in the solution (see Step 1). As the system runs, live data at 10s intervals adds 360 observations per hour per AP, so density improves rapidly — after ~1 hour of runtime, recent hour bins have >300 points.

### Key Files

| File | What it does |
|------|-------------|
| `backend/storage/metrics_store.py` | TinyFlux storage, `query_range()`, `compute_distribution_series()` |
| `backend/server/http_api.py` | HTTP endpoints, `/api/metrics/{metric}` |
| `backend/server/models.py` | Pydantic response models (Distribution, MetricResponse, etc.) |
| `backend/simulator/realistic_generator.py` | Driver-based metric generation (OU process + sensitivity matrix) |
| `backend/simulator/bootstrap.py` | Tiered historical data generation (~30 days) |
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

Each AP has distinct topology parameters in `config_enterprise.json` — different `load_baseline` and `rf_baseline` values that shift the driver means. For example, AP-Floor3-02 ("Dense office") has `load_baseline=0.60` vs the default `0.50`, producing systematically different metric profiles. This is why baselines must be per-AP.

## Proposed Solution

### 0. Prerequisite: Per-AP bootstrap data

**Problem**: The current `bootstrap.py` generates all historical observations without an AP entity tag — everything is stored as `_global`. Per-AP baselines require per-AP historical data.

**Change**: Modify `bootstrap.py` to generate observations for each of the 6 APs defined in the active config's `ap_topology`. For each tier timestamp, call `generate_observation(metric, timestamp, entity=ap_name)` for every AP, respecting each AP's topology offsets (`load_baseline`, `rf_baseline`).

**Impact**: Data volume increases ~6x (from ~7,000 to ~42,000 total observations). This is still small for TinyFlux and adds negligible startup time. The `generate_observation()` method in `realistic_generator.py` already maintains per-entity driver state and applies topology offsets — the mechanism exists, bootstrap just doesn't use it.

**Storage changes required**: `metrics_store.py` currently stores only `metric` as a TinyFlux tag — there is no entity field. The following changes are needed:
- `insert_observation()` and `insert_batch()`: add `entity` to the TinyFlux `tags` dict (e.g., `tags={"metric": obs["metric"], "entity": obs.get("entity", "_global")}`)
- `query_range()`: add an optional `entity` parameter and filter with `Tag.entity == entity` when provided
- Live streaming in `websocket_server.py`: tag streamed observations with the AP entity so baseline improves with runtime data

### 1. New backend endpoint: `/api/metrics/{metric}/baseline`

Add a method to `metrics_store.py`:

```python
def compute_baseline_distribution(self, metric: str, entity: str = None,
                                   lookback_days: int = 30) -> List[Dict]:
    """
    Compute hourly baseline distributions from historical data.

    Groups all observations by hour-of-day (0-23) across the lookback
    period and computes percentiles for each hour. This captures the
    daily rhythm (wider during business hours, narrower at night).

    Uses local time for hour-of-day grouping by default, to align with the
    simulator's daily rhythm (business hours, peak load patterns). An optional
    `tz` parameter accepts IANA timezone names (e.g., 'America/New_York',
    'UTC') for deterministic behavior across environments.

    When an entity (AP) is specified, computes the baseline from that AP's
    observations only. Falls back to global data if entity has insufficient
    observations.

    Returns 24 distribution points, one per hour.
    """
    from datetime import datetime
    import pytz

    end = int(time.time())
    start = end - (lookback_days * 86400)
    observations = self.query_range(metric, start, end, entity=entity)
    
    # Resolve timezone: explicit parameter > local system time
    tzinfo = pytz.timezone(tz) if tz else None

    # Correct for sampling bias: tiered bootstrap creates non-uniform density
    # (720 points in last 2h vs 40 across first 20 days). Resample to a fixed
    # cadence (1 observation per hour) before percentile computation to prevent
    # recent high-frequency tiers from dominating the baseline.
    observations = self._resample_to_fixed_cadence(observations, cadence_seconds=3600)

    # Group by hour-of-day using LOCAL time (matches simulator daily rhythm)
    hourly_bins = defaultdict(list)
    for obs in observations:
        dt = datetime.fromtimestamp(obs["timestamp"], tz=tzinfo)
        hour = dt.hour
        hourly_bins[hour].append(obs["value"])

    # Compute percentiles per hour
    result = []
    for hour in range(24):
        values = hourly_bins.get(hour, [])
        if len(values) >= 5:  # minimum for meaningful percentiles
            result.append({
                "hour": hour,
                "distribution": {
                    "p1": np.percentile(values, 1),
                    "p5": np.percentile(values, 5),
                    "p10": np.percentile(values, 10),
                    "p25": np.percentile(values, 25),
                    "p50": np.percentile(values, 50),
                    "p75": np.percentile(values, 75),
                    "p90": np.percentile(values, 90),
                    "p95": np.percentile(values, 95),
                    "p99": np.percentile(values, 99),
                    "mean": np.mean(values),
                    "stddev": np.std(values),
                    "count": len(values),
                },
                "fallback_source": "data",
                "sample_count": len(values),
            })

    # Cold-start fallback: fill gaps using tiered fallback hierarchy
    result = self._fill_baseline_gaps(result, metric, entity=entity)

    return result
```

**Cold-start fallback hierarchy**: When a baseline bin has fewer than 5 observations (common at startup, especially per-AP), fill the gap using a tiered fallback cascade that preserves realistic shape as much as possible:

1. **Entity hourly** (primary) — per-AP observations grouped into 1-hour bins. Used when `count >= 5`.
2. **Entity 4-hour bins** — widen the bin to 4 hours to gather more observations. Preserves per-AP characteristics with coarser time resolution.
3. **Global hourly, scaled by AP offsets** — use the global baseline for this hour, then adjust using the AP's `load_baseline` and `rf_baseline` topology offsets from config. Preserves realistic daily shape.
4. **Config synthetic** — generate a distribution from the metric's `baseline ± (typical_variance_pct / 100 × range)` from `config_enterprise.json`. Last resort.

```python
def _fill_baseline_gaps(self, baseline: List[Dict], metric: str,
                         entity: str = None) -> List[Dict]:
    """
    Fill missing hourly bins using a tiered fallback hierarchy.

    Fallback levels (in order of preference):
    1. Entity hourly (already in baseline — skip)
    2. Entity 4-hour bins (wider window, same AP)
    3. Global hourly scaled by AP topology offsets
    4. Config synthetic from baseline ± typical_variance_pct

    Each bin includes fallback_source metadata for observability.
    """
    covered_hours = {b["hour"] for b in baseline}
    if len(covered_hours) == 24:
        return baseline  # No gaps

    cfg = self._get_metric_config(metric)
    metric_range = cfg["max"] - cfg["min"]

    for hour in range(24):
        if hour in covered_hours:
            continue

        # Level 2: Try 4-hour bin for this entity
        dist = self._try_wider_bin(metric, entity, hour, bin_width=4)
        if dist:
            baseline.append({
                "hour": hour,
                "distribution": dist,
                "fallback_source": "entity_4h_bin",
                "sample_count": dist.pop("count", 0),
            })
            continue

        # Level 3: Global hourly scaled by AP offsets
        dist = self._try_global_scaled(metric, entity, hour)
        if dist:
            baseline.append({
                "hour": hour,
                "distribution": dist,
                "fallback_source": "global_scaled",
                "sample_count": dist.pop("count", 0),
            })
            continue

        # Level 4: Config synthetic
        variance = (cfg.get("typical_variance_pct", 3) / 100) * metric_range
        baseline.append({
            "hour": hour,
            "distribution": self._synthetic_distribution(cfg["baseline"], variance),
            "fallback_source": "synthetic_config",
            "sample_count": 0,
        })

    baseline.sort(key=lambda b: b["hour"])
    return baseline
```

**Transition criterion**: A synthetic or fallback bin is replaced by data-driven percentiles when the hourly bin accumulates ≥30 observations from the last 7 days. This ensures the transition is based on recent, representative data rather than just total count.

Add endpoint in `http_api.py`:

```python
@app.get("/api/metrics/{metric}/baseline")
async def get_baseline(metric: str, entity: str = None, lookback_days: int = 30,
                       tz: str = None):
    store = get_metrics_store()
    hourly = store.compute_baseline_distribution(metric, entity=entity,
                                                  lookback_days=lookback_days,
                                                  tz=tz)
    return {
        "metric": metric,
        "entity": entity,
        "lookback_days": lookback_days,
        "timezone": tz or "local",
        "hourly_distributions": hourly
    }
```

Add response model in `models.py`.

### 2. Frontend: Fetch baseline once per metric, cache it

In `api/client.ts`, add `fetchBaseline(metric, entity?, lookbackDays?)`.

In `main.ts`, when a metric is selected:
1. Fetch baseline for the selected AP entity (one-time, cache the result)
2. Pass to chart via `chart.setBaseline(metricName, hourlyDistributions)`
3. When the selected AP changes, fetch and cache the new AP's baseline

### 3. Frontend: Map baseline onto visible time range

In `ChartView.ts`, add a `setBaseline()` method that stores 24 hourly distributions. In `render()`, generate distribution points for the visible time range by:

1. Get visible range `[startTs, endTs]`
2. For each hour boundary within the visible range, look up the corresponding hourly baseline distribution
3. Generate timestamped `DistributionPoint[]` entries — one per hour boundary in the visible range
4. Pass the resulting `DistributionPoint[]` to `DistributionRibbonGenerator.update()`, which handles curve interpolation via `curveMonotoneX`

Since the baseline is a 24h cycle, this naturally tiles across any time range (1h, 24h, 7 days) and doesn't need recomputation on zoom/pan — just regenerate the mapping points from the cached baseline.

### 4. Remove old distribution plumbing

- Remove the sliding window distribution logic in `ChartView.ts:420-458`
- Remove the dead `recomputeDistributionSeries()` method
- Remove `distributionSeries` from MetricData interface
- Remove `currentDistribution` from MetricData (deprecated flat distribution)
- Remove `distribution_series` from the API response in `http_api.py` and the corresponding `compute_distribution_series()` call — since we control both frontend and backend, there is no backward compatibility concern, and keeping it adds unnecessary computation to every API call
- Remove `compute_distribution_series()` from `metrics_store.py` (dead code after the above)

### What stays the same

- `DistributionRibbonGenerator.ts` — unchanged. It renders whatever `DistributionPoint[]` it receives and handles curve interpolation.
- `LineGenerator.ts` — unchanged. The trace continues to show actual data.
- Backend observation generation logic (`realistic_generator.py`, `perturbations.py`) — unchanged.

**Note**: Backend storage (`metrics_store.py`) and live streaming (`websocket_server.py`) *are* changed — see Step 0 for entity tagging requirements.

## Future Enhancements (not in this PR)

- **Weekday/weekend split**: The simulator already models weekends at 40% load. Storing two baseline profiles (weekday + weekend, 48 bins total) and selecting the right one per day visible in the chart would capture the weekly rhythm. Deferred because it requires the frontend to determine day-of-week for each visible day.
- **Adaptive density**: As the system accumulates live data over weeks, the baseline gets more accurate. Could add a "baseline freshness" indicator.
- **Baseline anomaly scoring**: Compute how far the current trace is from the baseline p50, normalized by the baseline width. This gives a quantitative anomaly score for the AI chat agent to use.
- **Perturbation-aware baseline**: Future versions could exclude observations during known perturbation windows from the baseline computation, producing a "clean" baseline that represents truly normal behavior. This would make the baseline narrower and anomaly contrast sharper.
- **Structured incident scenarios**: Trigger specific perturbation patterns (DoS attack, cascading AP failure) and verify the baseline ribbon makes the impact immediately visually obvious.

## Verification Plan

1. **Bootstrap check**: Verify bootstrap generates per-AP observations — query the store for a specific AP entity and confirm data exists across the full 30-day range
2. **Backend unit check**: `curl "http://localhost:5011/api/metrics/coverage/baseline?entity=AP-Lobby"` — should return 24 hourly distributions with reasonable percentile values (coverage p50 should be around -54 to -55 dBm, wider during business hours 8-18)
3. **Per-AP differentiation check**: Compare baselines for AP-Floor3-02 (dense office, load_baseline=0.60) vs AP-Lobby (lobby, load_baseline=0.35) — the dense office should show systematically different baseline values reflecting its higher load
4. **Cold-start check**: Restart the app, immediately query the baseline endpoint — all 24 hours should be present (some may be flagged `synthetic: true`), no gaps
5. **Visual check**: Open localhost:5012, select Coverage — ribbon should show a smooth daily pattern that's wider during business hours
6. **Zoom/pan test**: Disable live mode, zoom to 1h, pan across the day — ribbon should smoothly show the appropriate baseline slice without cutoffs or rectangles
7. **Anomaly visibility test**: In live mode, watch for perturbation events — the trace should spike outside the ribbon, making the anomaly visually obvious
8. **Multi-day test**: Select "Last 24 Hours" — the baseline pattern should tile correctly showing the daily rhythm
9. **Playwright MCP**: Use browser automation at localhost:5012 to systematically verify zoom, pan, and time range changes produce correct ribbon behavior
