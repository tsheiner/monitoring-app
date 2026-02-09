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
  bufferedRange: [number, number] | null; // Track what time range is buffered
}

export class ChartView {
  private core: ChartCore;
  private sharedRange: SharedRange;
  private metrics: Map<string, MetricData> = new Map();
  private eventMarkers: EventMarkersGenerator | null = null;
  private config: ChartConfig;
  private hasLoadedData: boolean = false; // Track if historical data loaded
  private onDataNeededCallback?: (range: [number, number]) => void;

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

    // Wire up zoom/pan callback from ChartCore
    this.core.onRangeChange((range, userInitiated) => {
      this.handleZoomPanRangeChange(range, userInitiated);
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
      normalizedYDomain: [Infinity, -Infinity], // Will be set to actual data range on first load
      bufferedRange: null,
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

    // Update buffered range for this metric
    if (observations.length > 0) {
      const newStart = observations[0].timestamp;
      const newEnd = observations[observations.length - 1].timestamp;
      
      if (metricData.bufferedRange) {
        // Expand existing range
        metricData.bufferedRange = [
          Math.min(metricData.bufferedRange[0], newStart),
          Math.max(metricData.bufferedRange[1], newEnd)
        ];
      } else {
        // Initialize range
        metricData.bufferedRange = [newStart, newEnd];
      }
    }

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
        (dp) =>
          dp.timestamp >= range[0] - buffer &&
          dp.timestamp <= lastObsTime + buffer,
      );

      if (inRange.length > 0) {
        const padded: DistributionPoint[] = [];

        // Always add left edge point at range[0]
        padded.push({
          timestamp: range[0],
          distribution: inRange[0].distribution,
        });

        // Add interior points
        for (const dp of inRange) {
          if (dp.timestamp > range[0] && dp.timestamp < lastObsTime) {
            padded.push(dp);
          }
        }

        // Add right edge point at last observation (not range[1])
        padded.push({
          timestamp: lastObsTime,
          distribution: inRange[inRange.length - 1].distribution,
        });

        metricData.distributionSeries = padded;
      } else {
        metricData.distributionSeries = rawSeries;
      }
    } else {
      metricData.distributionSeries = rawSeries;
    }

    // Calculate Y domain for this metric's raw data
    if (observations.length > 0) {
      // Get ALL buffered data to calculate stable Y-domain
      const allBufferedData = metricData.dataTarget.getAll();
      
      if (allBufferedData.length > 0) {
        const values = allBufferedData.map((obs) => obs.value);
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);

        // Update domain ONLY if it expands (never shrink during pan)
        if (metricData.normalizedYDomain[0] === Infinity) {
          // First time: initialize with actual data range
          metricData.normalizedYDomain = [minVal, maxVal];
        } else {
          // Expand domain to include new data (but never shrink)
          metricData.normalizedYDomain = [
            Math.min(metricData.normalizedYDomain[0], minVal),
            Math.max(metricData.normalizedYDomain[1], maxVal)
          ];
        }

        console.log(`Metric ${metricName} Y domain: [${metricData.normalizedYDomain[0].toFixed(2)}, ${metricData.normalizedYDomain[1].toFixed(2)}] (from ${allBufferedData.length} buffered points)`);
      }
    }

    // Mark that we've loaded historical data
    this.hasLoadedData = true;

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
    // #region agent log
    const currentRange = this.sharedRange.getRange();
    const allMetricsData = Array.from(this.metrics.entries()).map(([name, data]) => ({
      name,
      bufferCount: data.dataTarget.getAll().length,
      domain: data.normalizedYDomain
    }));
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:updateGlobalYDomain',message:'Y-domain recalculation',data:{metricCount:this.metrics.size,visibleRange:currentRange,allMetricsData},timestamp:Date.now(),runId:'pan-rescale-debug',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    
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
      }
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
      series[0] = {
        timestamp: newRange[0],
        distribution: series[0].distribution,
      };

      // Prune distribution points that fell off the left edge
      while (series.length > 2 && series[1].timestamp < newRange[0]) {
        series.splice(1, 1);
        series[0] = {
          timestamp: newRange[0],
          distribution: series[1].distribution,
        };
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
      metricData.lineGenerator.setScales(
        this.core.getXScale(),
        this.core.getYScale(),
      );
    }
    this.render();

    // Note: The caller should reload historical data for the new range
  }

  /**
   * Update time range without clearing data (for pan/zoom operations).
   * This preserves buffered data and only updates the visible range.
   * The caller is responsible for fetching any missing data.
   */
  updateTimeRangeNonDestructive(start: number, end: number): void {
    this.durationSeconds = end - start;
    this.chartStartTime = start;
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartView.ts:updateTimeRangeNonDestructive',message:'Pan/zoom range update',data:{start,end,duration:end-start,willUpdateYDomain:true},timestamp:Date.now(),runId:'pan-rescale-debug',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    
    // Update shared range without clearing buffers
    this.sharedRange.setRange([start, end]);
    
    // Update Y domain and render with existing data
    this.updateGlobalYDomain();
    this.render();
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
    console.log(
      `Range changed: ${new Date(range[0] * 1000).toISOString()} to ${new Date(range[1] * 1000).toISOString()}`,
    );

    // Use setTimeRange to update without triggering zoom events
    this.core.setTimeRange(range);

    this.render();
  }

  /**
   * Handle zoom/pan range changes from user interaction.
   * Implements live mode auto-detection.
   */
  private handleZoomPanRangeChange(
    range: [number, number],
    userInitiated: boolean,
  ): void {
    if (!userInitiated) return;

    const now = Math.floor(Date.now() / 1000);
    const [start, end] = range;

    // Auto-detect live mode: if right edge is within 1 minute of "now", enable live mode
    const isAtNow = end >= now - 60;
    const wasLiveMode = this.config.liveMode;
    this.config.liveMode = isAtNow;

    if (wasLiveMode !== this.config.liveMode) {
      console.log(
        `Live mode ${this.config.liveMode ? "enabled" : "disabled"} (at now: ${isAtNow})`,
      );

      // Update UI checkbox if it exists
      const checkbox = document.getElementById("live-mode") as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = this.config.liveMode;
      }
    }

    // Update time range without clearing data (non-destructive)
    this.updateTimeRangeNonDestructive(start, end);

    // Check if we have data coverage for the range
    const hasDataForRange = this.checkDataCoverage(range);

    if (!hasDataForRange && this.onDataNeededCallback) {
      // Need to fetch missing data
      console.log(`Need to fetch data for range: ${start} to ${end}`);
      this.onDataNeededCallback(range);
    }
    // Note: Data renders immediately with what's in buffer
    // Fetch happens asynchronously in background if needed
  }

  /**
   * Check if we have data coverage for the given range.
   * Returns true only if we have data that covers the edges of the range
   * (allowing for small gaps in the middle).
   */
  private checkDataCoverage(range: [number, number]): boolean {
    if (this.metrics.size === 0) return true;

    const [rangeStart, rangeEnd] = range;
    const edgeThreshold = 60; // 60 seconds tolerance at edges

    // Check if at least one metric has data covering both edges of the range
    for (const [name, metricData] of this.metrics) {
      const data = metricData.dataTarget.getAll();
      if (data.length === 0) continue;

      const bufferStart = data[0].timestamp;
      const bufferEnd = data[data.length - 1].timestamp;

      // Check if buffer covers the left edge of the requested range
      const coversLeftEdge = bufferStart <= rangeStart + edgeThreshold;
      // Check if buffer covers the right edge of the requested range
      const coversRightEdge = bufferEnd >= rangeEnd - edgeThreshold;

      if (coversLeftEdge && coversRightEdge) {
        return true; // At least one metric has full coverage
      }
    }

    return false;
  }

  /**
   * Register callback for when more data is needed (e.g., when panning to new range).
   */
  onDataNeeded(callback: (range: [number, number]) => void): void {
    this.onDataNeededCallback = callback;
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
    // Redraw event markers if present
    if (this.eventMarkers && this.config.showEvents) {
      this.eventMarkers.redraw(range);
    }  }

  /**
   * Resize chart.
   */
  resize(width: number, height: number): void {
    this.config.width = width;
    this.config.height = height;

    this.core.resize(width, height);

    // Update scales for all generators after core resize
    for (const [name, metricData] of this.metrics) {
      metricData.lineGenerator.setScales(
        this.core.getXScale(),
        this.core.getYScale(),
      );
      metricData.lineGenerator.resize(width, height);

      if (metricData.distributionGenerator) {
        metricData.distributionGenerator.setScales(
          this.core.getXScale(),
          this.core.getYScale(),
        );
        metricData.distributionGenerator.resize(width, height);
      }
    }

    if (this.eventMarkers) {
      this.eventMarkers.setScales(this.core.getXScale(), this.core.getYScale());
      this.eventMarkers.resize(width, height);
    }

    this.render();
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
