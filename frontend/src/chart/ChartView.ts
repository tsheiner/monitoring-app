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
    metricData.distributionSeries = distributionSeries || [];

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

    // Update brush context range
    const allObservations = observations;
    if (allObservations.length > 0) {
      const minTime = allObservations[0].timestamp;
      const maxTime = allObservations[allObservations.length - 1].timestamp;
      const now = Math.floor(Date.now() / 1000);

      // Add buffer equal to requested duration for sliding
      const bufferDuration = this.durationSeconds;
      const brushStart = minTime - bufferDuration;
      const brushEnd = Math.max(maxTime, now);

      this.core.updateFullTimeRange([brushStart, brushEnd]);

      // Set brush selection to current range
      const currentRange = this.sharedRange.getRange();
      this.core.updateBrushSelection(currentRange);
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
          this.core.updateFullTimeRange([brushStart, brushEnd]);
        }
      }
    }

    // Update Y domain
    this.updateGlobalYDomain();

    // Recompute distribution for single metric
    if (
      this.metrics.size === 1 &&
      this.config.showDistribution &&
      this.config.liveMode
    ) {
      const [name, data] = Array.from(this.metrics.entries())[0];
      if (data === metricData) {
        this.recomputeDistributionSeries(name);
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
   * This updates the chart to show [NOW - duration, NOW].
   * Called when user changes time range dropdown.
   */
  setTimeRange(durationSeconds: number): void {
    this.durationSeconds = durationSeconds;
    const now = Math.floor(Date.now() / 1000);

    // Set range to [now - duration, now]
    this.chartStartTime = now - durationSeconds;

    // Clear data for all metrics before changing range
    for (const [name, metricData] of this.metrics) {
      metricData.dataTarget.clear();
      metricData.distributionSeries = [];
      if (metricData.distributionGenerator) {
        metricData.distributionGenerator.hide();
      }
    }

    this.sharedRange.setRange([this.chartStartTime, now]);

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
   */
  setShowDistribution(enabled: boolean): void {
    this.config.showDistribution = enabled;

    if (enabled && !this.distributionGenerator) {
      this.distributionGenerator = new DistributionRibbonGenerator(
        this.core.getChartGroup(),
        this.config.colors.distribution,
      );
      this.distributionGenerator.setScales(
        this.core.getXScale(),
        this.core.getYScale(),
      );
      this.render();
    } else if (!enabled && this.distributionGenerator) {
      this.distributionGenerator.hide();
    } else if (enabled && this.distributionGenerator) {
      this.distributionGenerator.show();
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
    this.core.updateXDomain(range);

    if (this.hasLoadedData) {
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

        // Render distribution for single metric
        if (metricData.distributionGenerator && this.config.showDistribution) {
          if (metricData.distributionSeries.length > 0) {
            const distributionInRange = metricData.distributionSeries.filter(
              (dp) => dp.timestamp >= range[0] && dp.timestamp <= range[1],
            );

            if (distributionInRange.length > 0) {
              metricData.distributionGenerator.update(
                distributionInRange,
                range,
              );
            } else {
              metricData.distributionGenerator.hide();
            }
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
    this.config.width = width;
    this.config.height = height;

    this.core.resize(width, height);

    for (const [name, metricData] of this.metrics) {
      metricData.lineGenerator.resize(width, height);
      if (metricData.distributionGenerator) {
        metricData.distributionGenerator.resize(width, height);
      }
    }

    if (this.eventMarkers) {
      this.eventMarkers.resize(width, height);
    }

    this.render();
  }

  /**
   * Handle brush selection for range zooming.
   */
  private handleBrushSelection(range: [number, number]): void {
    // Disable live mode when user zooms
    this.config.liveMode = false;

    // Update duration
    this.durationSeconds = range[1] - range[0];

    // Update the shared range
    this.sharedRange.setRange(range);

    // Notify that a new range was selected
    if (this.onRangeSelectedCallback) {
      this.onRangeSelectedCallback(range);
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
