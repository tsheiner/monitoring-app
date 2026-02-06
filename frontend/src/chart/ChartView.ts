/**
 * ChartView - Main chart orchestrator.
 *
 * Implements juttle-viz inspired architecture with:
 * - Duration-based display (shows last N seconds)
 * - Growth phase: line grows left→right until duration is filled
 * - Steady state: sliding window where right edge = now
 * - Automatic downsampling based on point density
 * - Multi-metric support with independent normalization
 */

import { ChartCore } from "./ChartCore";
import { SharedRange } from "./SharedRange";
import { DataTarget } from "./DataTarget";
import { LineGenerator } from "./generators/LineGenerator";
import { DistributionRibbonGenerator } from "./generators/DistributionRibbonGenerator";
import { EventMarkersGenerator } from "./generators/EventMarkersGenerator";
import {
  ChartConfig,
  Observation,
  Distribution,
  DistributionPoint,
  Event,
} from "./types";

interface MetricData {
  dataTarget: DataTarget;
  lineGenerator: LineGenerator;
  distributionGenerator: DistributionRibbonGenerator | null;
  distributionSeries: DistributionPoint[];
  currentDistribution: Distribution | null;
  color: string;
  normalizedYDomain: [number, number]; // For independent normalization
}

export class ChartView {
  private core: ChartCore;
  private sharedRange: SharedRange;
  private metrics: Map<string, MetricData> = new Map();
  private eventMarkers: EventMarkersGenerator | null = null;
  private config: ChartConfig;
  private hasLoadedData: boolean = false; // Track if historical data loaded
  private onRangeSelectedCallback?: (range: [number, number]) => void;

  // Track chart start time for growth phase
  private chartStartTime: number;
  private durationSeconds: number;

  constructor(container: HTMLElement, config: ChartConfig) {
    this.config = config;

    // Duration is the width of the time window
    this.durationSeconds = config.timeRange[1] - config.timeRange[0];

    // Use the time range from config (should be [NOW - duration, NOW])
    this.chartStartTime = config.timeRange[0];

    // Initialize core with the FULL time range immediately
    this.core = new ChartCore(container, config);

    // Initialize shared range with FULL window [past, now]
    this.sharedRange = new SharedRange(config.timeRange);

    // Initialize event markers if enabled
    if (config.showEvents) {
      this.eventMarkers = new EventMarkersGenerator(
        this.core.getChartGroup(),
        config.colors.event,
        config.colors.eventHover,
      );
      this.eventMarkers.setScales(this.core.getXScale(), this.core.getYScale());
    }

    // Subscribe to range changes
    this.sharedRange.onChange((range) => {
      this.onRangeChange(range);
    });

    // Wire up brush control to update time range
    this.core.onBrushChange((range) => {
      this.handleBrushSelection(range);
    });
  }

  /**
   * Add a metric to the chart.
   */
  addMetric(metricName: string, color: string): void {
    if (this.metrics.has(metricName)) {
      return; // Already added
    }

    const dataTarget = new DataTarget();

    // Create line generator with 1px stroke and 2px radius (4px diameter) markers
    const lineGenerator = new LineGenerator(
      this.core.getChartGroup(),
      color,
      1, // strokeWidth
      2, // markerRadius
    );
    lineGenerator.setScales(this.core.getXScale(), this.core.getYScale());

    // Only create distribution if this is the only metric
    let distributionGenerator: DistributionRibbonGenerator | null = null;
    if (this.metrics.size === 0 && this.config.showDistribution) {
      distributionGenerator = new DistributionRibbonGenerator(
        this.core.getChartGroup(),
        color,
      );
      distributionGenerator.setScales(
        this.core.getXScale(),
        this.core.getYScale(),
      );
    }

    this.metrics.set(metricName, {
      dataTarget,
      lineGenerator,
      distributionGenerator,
      distributionSeries: [],
      currentDistribution: null,
      color,
      normalizedYDomain: [0, 1],
    });

    console.log(
      `Added metric: ${metricName}, total metrics: ${this.metrics.size}`,
    );
  }

  /**
   * Remove a metric from the chart.
   */
  removeMetric(metricName: string): void {
    const metricData = this.metrics.get(metricName);
    if (!metricData) return;

    metricData.lineGenerator.destroy();
    if (metricData.distributionGenerator) {
      metricData.distributionGenerator.destroy();
    }

    this.metrics.delete(metricName);

    // If we're back to single metric, may need to recreate distribution
    // #region agent log
      fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:removeMetric',message:'After removing metric, checking distribution recreation',data:{removedMetric:metricName,remainingCount:this.metrics.size,showDist:this.config.showDistribution,remainingMetrics:Array.from(this.metrics.keys()),remainingDistSeries:Array.from(this.metrics.values()).map(m=>({hasGen:!!m.distributionGenerator,seriesLen:m.distributionSeries.length}))},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    if (this.metrics.size === 1 && this.config.showDistribution) {
      const [remainingMetric, remainingData] = Array.from(
        this.metrics.entries(),
      )[0];
      if (!remainingData.distributionGenerator) {
        remainingData.distributionGenerator = new DistributionRibbonGenerator(
          this.core.getChartGroup(),
          remainingData.color,
        );
        remainingData.distributionGenerator.setScales(
          this.core.getXScale(),
          this.core.getYScale(),
        );
      }
    }

    this.updateGlobalYDomain();
    this.render();
    console.log(
      `Removed metric: ${metricName}, remaining metrics: ${this.metrics.size}`,
    );
  }

  /**
   * Check if a metric is currently displayed.
   */
  hasMetric(metricName: string): boolean {
    return this.metrics.has(metricName);
  }

  /**
   * Load historical data for a specific metric.
   */
  loadHistoricalData(
    metricName: string,
    observations: Observation[],
    distribution: Distribution | null = null,
    distributionSeries: DistributionPoint[] = [],
  ): void {
    const metricData = this.metrics.get(metricName);
    if (!metricData) {
      console.warn(`Cannot load data for unknown metric: ${metricName}`);
      return;
    }

    console.log(
      `Loading ${observations.length} observations for ${metricName}, has distribution series: ${distributionSeries?.length > 0}`,
    );

    metricData.dataTarget.push(observations);
    metricData.currentDistribution = distribution;

    // Clamp distribution series to match the actual extent of the data.
    // Left edge: clamp to range[0] (historical data typically starts at/before range).
    // Right edge: clamp to the last observation's timestamp, NOT range[1].
    // This prevents the ribbon from projecting flat through time gaps where
    // no data exists (e.g., between historical data end and live "now").
    const rawSeries = distributionSeries || [];
    if (rawSeries.length > 0 && observations.length > 0) {
      const range = this.sharedRange.getRange();
      const duration = range[1] - range[0];
      const buffer = duration * 0.05;

      // Right edge = last observation timestamp (where actual data ends)
      const lastObsTime = observations[observations.length - 1].timestamp;

      // Keep points within generous buffer of visible range
      const inRange = rawSeries.filter(
        (dp) => dp.timestamp >= (range[0] - buffer) && dp.timestamp <= (lastObsTime + buffer),
      );

      if (inRange.length > 0) {
        const padded: DistributionPoint[] = [];

        // Always add left edge point at range[0]
        padded.push({ timestamp: range[0], distribution: inRange[0].distribution });

        // Add interior points
        for (const dp of inRange) {
          if (dp.timestamp > range[0] && dp.timestamp < lastObsTime) {
            padded.push(dp);
          }
        }

        // Add right edge point at last observation (not range[1])
        padded.push({ timestamp: lastObsTime, distribution: inRange[inRange.length - 1].distribution });

        metricData.distributionSeries = padded;
      } else {
        metricData.distributionSeries = rawSeries;
      }
    } else {
      metricData.distributionSeries = rawSeries;
    }

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:loadHistoricalData',message:'Data loaded for metric',data:{metricName,obsCount:observations.length,lastObsTs:observations.length>0?observations[observations.length-1].timestamp:null,distSeriesLen:metricData.distributionSeries.length,firstDistTs:metricData.distributionSeries[0]?.timestamp,lastDistTs:metricData.distributionSeries[metricData.distributionSeries.length-1]?.timestamp,currentRange:this.sharedRange.getRange()},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix-v2',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    // Calculate Y domain for this metric's raw data
    if (observations.length > 0) {
      const values = observations.map((obs) => obs.value);
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);

      // Store the normalization domain for this metric
      metricData.normalizedYDomain = [minVal, maxVal];

      console.log(`Metric ${metricName} Y domain: [${minVal}, ${maxVal}]`);
    }

    // Mark that we've loaded historical data
    this.hasLoadedData = true;

    // Update brush context range - compute global min/max across ALL metrics
    // to prevent brush from shrinking when individual metrics are loaded
    if (observations.length > 0) {
      let globalMinTime = observations[0].timestamp;
      let globalMaxTime = observations[observations.length - 1].timestamp;

      // Check all metrics to find true global min/max
      for (const [name, metricData] of this.metrics) {
        const allObs = metricData.dataTarget.getAll();
        if (allObs.length > 0) {
          globalMinTime = Math.min(globalMinTime, allObs[0].timestamp);
          globalMaxTime = Math.max(globalMaxTime, allObs[allObs.length - 1].timestamp);
        }
      }

      const now = Math.floor(Date.now() / 1000);
      // Add buffer equal to requested duration for sliding
      const bufferDuration = this.durationSeconds;
      
      // Constrain brush to reasonable data boundaries:
      // - Start: Earlier of (globalMinTime - buffer) or (90 days ago)
      // - End: Later of (now) or (globalMaxTime)
      const ninetyDaysAgo = now - (90 * 86400);
      const brushStart = Math.max(ninetyDaysAgo, globalMinTime - bufferDuration);
      const brushEnd = Math.max(globalMaxTime, now);

      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:loadHistoricalData:brushContext',message:'Updating brush context from ALL metrics',data:{metricName,obsCount:observations.length,globalMinTime,globalMaxTime,now,bufferDuration,brushStart,brushEnd,currentRange:this.sharedRange.getRange(),metricsChecked:this.metrics.size,ninetyDaysAgo},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test-fixed',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion

      // Only expand the brush context, never shrink it
      const currentBrushRange = this.core.getFullTimeRange();
      const expandedBrushStart = Math.min(currentBrushRange[0], brushStart);
      const expandedBrushEnd = Math.max(currentBrushRange[1], brushEnd);

      this.core.updateFullTimeRange([expandedBrushStart, expandedBrushEnd]);

      // ONLY update brush selection during initial load or when in live mode
      // Skip updating during brush-initiated interactions to avoid fighting
      if (this.config.liveMode) {
        const currentRange = this.sharedRange.getRange();
        this.core.updateBrushSelection(currentRange);

        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:loadHistoricalData:brushContext:updated',message:'Brush selection updated (live mode)',data:{metricsLoaded:this.metrics.size,currentRangeUsed:currentRange,liveMode:this.config.liveMode},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test-fixed',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:loadHistoricalData:brushContext:skipped',message:'Skipping brush selection update (user brushing)',data:{liveMode:this.config.liveMode,metricsSize:this.metrics.size},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test-fixed',hypothesisId:'H4'})}).catch(()=>{});
        // #endregion
      }
    }

    // Compute global Y domain across all visible metrics (normalized to 0-100)
    this.updateGlobalYDomain();

    // Ensure line generators have updated scales
    for (const [name, metricData] of this.metrics) {
      metricData.lineGenerator.setScales(
        this.core.getXScale(),
        this.core.getYScale(),
      );
    }

    this.render();
  }

  /**
   * Update global Y domain (always 0-100 for normalized display).
   */
  private updateGlobalYDomain(): void {
    if (this.metrics.size > 1) {
      // Multiple metrics: use normalized 0-100 range
      this.core.updateYDomain([0, 100]);
    } else if (this.metrics.size === 1) {
      // Single metric: use actual values from entire dataset
      const [metricName, metricData] = Array.from(this.metrics.entries())[0];

      // Use the stored normalizedYDomain which contains min/max from all loaded data
      if (metricData.normalizedYDomain[0] !== Infinity) {
        this.core.updateYDomain(metricData.normalizedYDomain);
      }
    }
  }

  /**
   * Normalize a value from metric's domain to 0-100 range.
   */
  private normalizeValue(value: number, domain: [number, number]): number {
    const [min, max] = domain;
    if (max === min) return 50; // Avoid division by zero
    return ((value - min) / (max - min)) * 100;
  }

  /**
   * Append live observation for a specific metric.
   * In live mode, this slides the window forward.
   */
  appendLiveData(metricName: string, observation: Observation): void {
    const metricData = this.metrics.get(metricName);
    if (!metricData) {
      console.warn(`Cannot append data for unknown metric: ${metricName}`);
      return;
    }

    metricData.dataTarget.push([observation]);

    // If in live mode, slide the window forward (once for all metrics)
    if (this.config.liveMode) {
      const now = observation.timestamp;
      const currentRange = this.sharedRange.getRange();

      // Only slide the window if the new observation is beyond the current range
      if (now > currentRange[1]) {
        console.log(`Sliding window: ${now} > ${currentRange[1]}`);
        const newRange: [number, number] = [now - this.durationSeconds, now];
        this.sharedRange.setRange(newRange);

        // Prune old data for all metrics
        const pruneStart = newRange[0] - this.durationSeconds;
        for (const [name, data] of this.metrics) {
          data.dataTarget.pruneOutsideRange(pruneStart, newRange[1]);
        }

        // Update brush context
        const allObs = metricData.dataTarget.getAll();
        if (allObs.length > 0) {
          const minTime = allObs[0].timestamp;
          const maxTime = allObs[allObs.length - 1].timestamp;
          const bufferDuration = this.durationSeconds;
          const brushStart = minTime - bufferDuration;
          const brushEnd = Math.max(maxTime, now);

          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:appendLiveData:brushUpdate',message:'Updating brush context from live slide',data:{metricName,obsTs:observation.timestamp,now,currentRangeEnd:currentRange[1],newRangeStart:newRange[0],newRangeEnd:newRange[1],brushStart,brushEnd},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H5'})}).catch(()=>{});
          // #endregion

          this.core.updateFullTimeRange([brushStart, brushEnd]);
        }
      }
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:appendLiveData:notLiveMode',message:'Live data arrived but not in live mode',data:{metricName,obsTs:observation.timestamp,liveModeFlag:this.config.liveMode},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H2'})}).catch(()=>{});
      // #endregion
    }

    // Update Y domain
    this.updateGlobalYDomain();

    // Slide the distribution left edge to track the sliding window.
    // The right edge stays at the last meaningful data point (set by
    // loadHistoricalData) - we don't force-extend it to "now" because
    // that would project the distribution flat through data gaps.
    // As new live data arrives, we extend the right edge to match.
    if (
      this.metrics.size === 1 &&
      this.config.showDistribution &&
      this.config.liveMode &&
      metricData.distributionSeries.length >= 2
    ) {
      const newRange = this.sharedRange.getRange();
      const series = metricData.distributionSeries;

      // Slide left edge to new range start
      series[0] = { timestamp: newRange[0], distribution: series[0].distribution };

      // Prune distribution points that fell off the left edge
      while (series.length > 2 && series[1].timestamp < newRange[0]) {
        series.splice(1, 1);
        series[0] = { timestamp: newRange[0], distribution: series[1].distribution };
      }

      // Extend right edge to include the new live observation, using the
      // last distribution values. This grows the ribbon incrementally as
      // new data arrives.
      const lastDistTs = series[series.length - 1].timestamp;
      if (observation.timestamp > lastDistTs) {
        series[series.length - 1] = {
          timestamp: observation.timestamp,
          distribution: series[series.length - 1].distribution,
        };
      }
    }

    this.render();
  }

  /**
   * Update events display.
   */
  updateEvents(events: Event[]): void {
    if (this.eventMarkers) {
      const range = this.sharedRange.getRange();
      this.eventMarkers.update(events, range);
    }
  }

  /**
   * Set time range (duration).
   * This updates the chart to show [end - duration, end].
   * Called when user changes time range dropdown.
   */
  setTimeRange(durationSeconds: number, end: number): void {
    this.durationSeconds = durationSeconds;

    // Set range to [end - duration, end]
    this.chartStartTime = end - durationSeconds;

    // Clear data for all metrics before changing range
    for (const [name, metricData] of this.metrics) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:setTimeRange:clearingData',message:'CLEARING data in setTimeRange',data:{metric:name,dataCountBeforeClear:metricData.dataTarget.count(),distSeriesLen:metricData.distributionSeries.length,durationSeconds},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      metricData.dataTarget.clear();
      metricData.distributionSeries = [];
      if (metricData.distributionGenerator) {
        metricData.distributionGenerator.hide();
      }
    }

    this.sharedRange.setRange([this.chartStartTime, end]);

    // Update scales and render to ensure chart is not blank
    this.updateGlobalYDomain();
    for (const [name, metricData] of this.metrics) {
      metricData.lineGenerator.setScales(this.core.getXScale(), this.core.getYScale());
    }
    this.render();

    // Note: The caller should reload historical data for the new range
  }

  /**
   * Get current time range.
   */
  getTimeRange(): [number, number] {
    return this.sharedRange.getRange();
  }

  /**
   * Toggle live mode.
   */
  setLiveMode(enabled: boolean): void {
    this.config.liveMode = enabled;

    if (!enabled) {
      // When disabling live mode, freeze at current range
      // User can now pan/zoom manually (future feature)
    }
  }

  /**
   * Toggle distribution display.
   * FIX E: Updated to work with per-metric distribution generators.
   */
  setShowDistribution(enabled: boolean): void {
    this.config.showDistribution = enabled;

    for (const [name, metricData] of this.metrics) {
      if (metricData.distributionGenerator) {
        if (enabled) {
          metricData.distributionGenerator.show();
        } else {
          metricData.distributionGenerator.hide();
        }
      }
    }

    if (enabled) {
      this.render();
    }
  }

  /**
   * Toggle events display.
   */
  setShowEvents(enabled: boolean): void {
    this.config.showEvents = enabled;

    if (enabled && this.eventMarkers) {
      this.eventMarkers.show();
    } else if (!enabled && this.eventMarkers) {
      this.eventMarkers.hide();
    }
  }

  /**
   * Handle range change.
   */
  private onRangeChange(range: [number, number]): void {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:onRangeChange',message:'Range changed, updating X domain',data:{rangeStart:range[0],rangeEnd:range[1],duration:range[1]-range[0],hasLoadedData:this.hasLoadedData,liveMode:this.config.liveMode,currentDurationSeconds:this.durationSeconds,sharedRangeValue:this.sharedRange.getRange()},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H8'})}).catch(()=>{});
    // #endregion

    console.log(
      `Range changed: ${new Date(range[0] * 1000).toISOString()} to ${new Date(range[1] * 1000).toISOString()}`,
    );
    this.core.updateXDomain(range);

    if (this.hasLoadedData && this.config.liveMode) {
      this.core.updateBrushSelection(range);
    }

    this.render();
  }

  /**
   * Recompute distribution series from buffered data for a specific metric.
   */
  private recomputeDistributionSeries(metricName: string): void {
    const metricData = this.metrics.get(metricName);
    if (!metricData) return;

    const range = this.sharedRange.getRange();
    const duration = range[1] - range[0];

    // Determine bucket size based on duration
    let bucketSize: number;
    if (duration <= 3600) {
      bucketSize = 300; // 5 minutes
    } else if (duration <= 14400) {
      bucketSize = 900; // 15 minutes
    } else if (duration <= 86400) {
      bucketSize = 3600; // 1 hour
    } else {
      bucketSize = 10800; // 3 hours
    }

    // Compute distribution for each bucket
    const newSeries: DistributionPoint[] = [];
    for (let t = range[0]; t < range[1]; t += bucketSize) {
      const bucketEnd = Math.min(t + bucketSize, range[1]);
      const dist = metricData.dataTarget.computeDistributionInRange(
        t,
        bucketEnd,
      );

      if (dist) {
        newSeries.push({
          timestamp: t + bucketSize / 2,
          distribution: dist,
        });
      }
    }

    if (newSeries.length > 0) {
      const firstDist = newSeries[0].distribution;
      const lastDist = newSeries[newSeries.length - 1].distribution;

      metricData.distributionSeries = [
        { timestamp: range[0], distribution: firstDist },
        ...newSeries,
        { timestamp: range[1], distribution: lastDist },
      ];
    }
  }

  /**
   * Render all generators.
   */
  private render(): void {
    const range = this.sharedRange.getRange();

    // Render each metric
    for (const [metricName, metricData] of this.metrics) {
      const observations = metricData.dataTarget.getInRange(range[0], range[1]);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:render',message:'Rendering metric',data:{metricName,obsCount:observations.length,totalInBuffer:metricData.dataTarget.count(),metricsSize:this.metrics.size,rangeStart:range[0],rangeEnd:range[1],distSeriesLen:metricData.distributionSeries.length,hasDistGen:!!metricData.distributionGenerator,showDist:this.config.showDistribution,firstDistTs:metricData.distributionSeries[0]?.timestamp,lastDistTs:metricData.distributionSeries[metricData.distributionSeries.length-1]?.timestamp},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'B'})}).catch(()=>{});
      // #endregion

      if (this.metrics.size > 1) {
        // Multiple metrics: normalize to 0-100
        const normalizedObs = observations.map((obs) => ({
          timestamp: obs.timestamp,
          value: this.normalizeValue(obs.value, metricData.normalizedYDomain),
        }));
        metricData.lineGenerator.update(normalizedObs, range);

        // Hide distribution for multi-metric view
        if (metricData.distributionGenerator) {
          metricData.distributionGenerator.hide();
        }
      } else {
        // Single metric: use actual values
        metricData.lineGenerator.update(observations, range);

        // FIX C: Explicitly show distribution when in single-metric mode.
        // It may have been hidden during a prior multi-metric render.
        // Render distribution for single metric
        if (metricData.distributionGenerator && this.config.showDistribution) {
          metricData.distributionGenerator.show();

          if (metricData.distributionSeries.length > 0) {
            // Distribution series is already clamped to range edges by
            // loadHistoricalData and kept in sync by appendLiveData.
            // Pass it directly - no filtering needed.
            metricData.distributionGenerator.update(
              metricData.distributionSeries,
              range,
            );
          } else if (metricData.currentDistribution) {
            // Fallback: static distribution
            const numPoints = 20;
            const step = (range[1] - range[0]) / (numPoints - 1);
            const distributionPoints = [];

            for (let i = 0; i < numPoints; i++) {
              distributionPoints.push({
                timestamp: range[0] + i * step,
                distribution: metricData.currentDistribution,
              });
            }

            metricData.distributionGenerator.update(distributionPoints, range);
          } else {
            metricData.distributionGenerator.hide();
          }
        }
      }
    }
  }

  /**
   * Resize chart.
   */
  resize(width: number, height: number): void {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:resize',message:'Resizing chart',data:{oldWidth:this.config.width,oldHeight:this.config.height,newWidth:width,newHeight:height,metricsCount:this.metrics.size},timestamp:Date.now(),sessionId:'debug-session',runId:'resize-test',hypothesisId:'H10'})}).catch(()=>{});
    // #endregion

    this.config.width = width;
    this.config.height = height;

    this.core.resize(width, height);

    // Update scales for all generators after core resize
    for (const [name, metricData] of this.metrics) {
      metricData.lineGenerator.setScales(
        this.core.getXScale(),
        this.core.getYScale()
      );
      metricData.lineGenerator.resize(width, height);
      
      if (metricData.distributionGenerator) {
        metricData.distributionGenerator.setScales(
          this.core.getXScale(),
          this.core.getYScale()
        );
        metricData.distributionGenerator.resize(width, height);
      }
    }

    if (this.eventMarkers) {
      this.eventMarkers.setScales(
        this.core.getXScale(),
        this.core.getYScale()
      );
      this.eventMarkers.resize(width, height);
    }

    this.render();

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:resize:complete',message:'Resize complete, rendered',data:{width,height},timestamp:Date.now(),sessionId:'debug-session',runId:'resize-test',hypothesisId:'H10'})}).catch(()=>{});
    // #endregion
  }

  /**
   * Handle brush selection for range zooming.
   */
  private handleBrushSelection(range: [number, number]): void {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:handleBrushSelection',message:'Brush selection received from user',data:{rangeStart:range[0],rangeEnd:range[1],duration:range[1]-range[0],liveModeBeforeDisable:this.config.liveMode,currentDurationSeconds:this.durationSeconds},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion

    // Disable live mode when user zooms
    const wasLiveMode = this.config.liveMode;
    this.config.liveMode = false;

    // Update duration
    this.durationSeconds = range[1] - range[0];

    // Update the shared range
    this.sharedRange.setRange(range);

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:handleBrushSelection:after',message:'Live mode disabled, calling callback',data:{liveModeAfter:this.config.liveMode,newDuration:this.durationSeconds,hasCallback:!!this.onRangeSelectedCallback,wasLiveMode},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion

    // Notify that a new range was selected
    if (this.onRangeSelectedCallback) {
      this.onRangeSelectedCallback(range);
    }

    // Auto-re-enable live mode after a brief delay (3 seconds)
    // This allows user to brush without immediately returning to live mode
    if (wasLiveMode) {
      setTimeout(() => {
        // Only re-enable if user hasn't manually disabled it via checkbox
        const checkbox = document.getElementById('live-mode') as HTMLInputElement;
        if (checkbox && checkbox.checked) {
          this.config.liveMode = true;
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:handleBrushSelection:autoReEnable',message:'Auto-re-enabled live mode after brush',data:{liveMode:this.config.liveMode},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H7'})}).catch(()=>{});
          // #endregion
        }
      }, 3000);
    }
  }

  /**
   * Register callback for when user selects a new time range via brush.
   */
  onRangeSelected(callback: (range: [number, number]) => void): void {
    this.onRangeSelectedCallback = callback;
  }

  /**
   * Cleanup and destroy.
   */
  destroy(): void {
    this.core.destroy();

    for (const [name, metricData] of this.metrics) {
      metricData.lineGenerator.destroy();
      if (metricData.distributionGenerator) {
        metricData.distributionGenerator.destroy();
      }
    }

    if (this.eventMarkers) {
      this.eventMarkers.destroy();
    }
  }
}
