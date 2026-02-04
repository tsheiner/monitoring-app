/**
 * ChartView - Main chart orchestrator.
 *
 * Implements juttle-viz inspired architecture with:
 * - Duration-based display (shows last N seconds)
 * - Growth phase: line grows left→right until duration is filled
 * - Steady state: sliding window where right edge = now
 * - Automatic downsampling based on point density
 */

import { ChartCore } from "./ChartCore";
import { SharedRange } from "./SharedRange";
import { DataTarget } from "./DataTarget";
import { LineGenerator } from "./generators/LineGenerator";
import { DistributionRibbonGenerator } from "./generators/DistributionRibbonGenerator";
import { EventMarkersGenerator } from "./generators/EventMarkersGenerator";
import { ChartConfig, Observation, Distribution, Event } from "./types";

export class ChartView {
  private core: ChartCore;
  private sharedRange: SharedRange;
  private dataTarget: DataTarget;
  private lineGenerator: LineGenerator;
  private distributionGenerator: DistributionRibbonGenerator | null = null;
  private eventMarkers: EventMarkersGenerator | null = null;
  private config: ChartConfig;
  private currentDistribution: Distribution | null = null;

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

    // Initialize data target
    this.dataTarget = new DataTarget();

    // Initialize line generator
    this.lineGenerator = new LineGenerator(
      this.core.getChartGroup(),
      config.colors.line,
    );
    this.lineGenerator.setScales(this.core.getXScale(), this.core.getYScale());

    // Initialize distribution generator if enabled
    if (config.showDistribution) {
      this.distributionGenerator = new DistributionRibbonGenerator(
        this.core.getChartGroup(),
        config.colors.distribution,
      );
      this.distributionGenerator.setScales(
        this.core.getXScale(),
        this.core.getYScale(),
      );
    }

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
  }

  /**
   * Load historical data.
   * This sets up the initial view with past data.
   * Clear existing data and set time range based on what's loaded.
   */
  loadHistoricalData(
    observations: Observation[],
    distribution: Distribution | null,
  ): void {
    console.log(`Loading ${observations.length} historical observations`);

    // Clear existing data first
    this.dataTarget.clear();

    // Store data
    this.dataTarget.push(observations);
    this.currentDistribution = distribution;

    // Update Y domain based on data
    const yDomain = this.dataTarget.getYDomain();
    this.core.updateYDomain(yDomain);

    // Make sure time range is set correctly
    const range = this.sharedRange.getRange();
    this.core.updateXDomain(range);

    // Render
    this.render();
  }

  /**
   * Append live observation.
   * In live mode, this slides the window forward.
   */
  appendLiveData(observation: Observation): void {
    this.dataTarget.push([observation]);

    // If in live mode, slide the window forward
    if (this.config.liveMode) {
      const now = observation.timestamp;
      const currentRange = this.sharedRange.getRange();
      
      console.log(`Live data: ${new Date(now * 1000).toISOString()}, current range end: ${new Date(currentRange[1] * 1000).toISOString()}`);
      
      // Only slide the window if the new observation is beyond the current range
      // This prevents jumping forward and losing historical data when live mode first starts
      if (now > currentRange[1]) {
        console.log(`Sliding window: ${now} > ${currentRange[1]}`);
        // Steady state: sliding window - keep duration constant
        // Move both edges forward so right edge = now
        const newRange: [number, number] = [now - this.durationSeconds, now];
        this.sharedRange.setRange(newRange);

        // Prune old data outside the visible window to prevent memory leak
        this.dataTarget.pruneOutsideRange(newRange[0], newRange[1]);
      }
    }

    // Recalculate Y domain based on VISIBLE data only
    const range = this.sharedRange.getRange();
    const visibleObservations = this.dataTarget.getInRange(range[0], range[1]);
    if (visibleObservations.length > 0) {
      const yMin = Math.min(...visibleObservations.map((obs) => obs.value));
      const yMax = Math.max(...visibleObservations.map((obs) => obs.value));
      this.core.updateYDomain([yMin, yMax]);
    }

    // Render
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
    this.sharedRange.setRange([this.chartStartTime, now]);

    // Note: The caller should reload historical data for the new range
    // This just updates the time axis
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
    this.render();
  }

  /**
   * Render all generators.
   */
  private render(): void {
    const range = this.sharedRange.getRange();
    const observations = this.dataTarget.getInRange(range[0], range[1]);

    console.log(`Rendering ${observations.length} observations in range`);

    // Render line
    this.lineGenerator.update(observations, range);

    // Render distribution if we have it
    // For MVP: create distribution ribbon spanning entire visible range
    // TODO: compute rolling distributions in time buckets for time-varying bands
    if (
      this.distributionGenerator &&
      this.currentDistribution &&
      this.config.showDistribution
    ) {
      // Safety check: ensure distribution has required fields
      if (
        this.currentDistribution.p5 !== undefined &&
        this.currentDistribution.p25 !== undefined &&
        this.currentDistribution.p75 !== undefined &&
        this.currentDistribution.p95 !== undefined
      ) {
        // Create distribution points at regular intervals across visible range
        // This makes the ribbon render as smooth horizontal bands
        const numPoints = 20; // More points = smoother rendering
        const step = (range[1] - range[0]) / (numPoints - 1);
        const distributionPoints = [];

        for (let i = 0; i < numPoints; i++) {
          distributionPoints.push({
            timestamp: range[0] + i * step,
            distribution: this.currentDistribution,
          });
        }

        this.distributionGenerator.update(distributionPoints, range);
      } else {
        console.warn(
          "Distribution missing required percentile fields, hiding ribbon",
        );
        this.distributionGenerator.hide();
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
    this.lineGenerator.resize(width, height);

    if (this.distributionGenerator) {
      this.distributionGenerator.resize(width, height);
    }

    if (this.eventMarkers) {
      this.eventMarkers.resize(width, height);
    }

    this.render();
  }

  /**
   * Cleanup and destroy.
   */
  destroy(): void {
    this.core.destroy();
    this.lineGenerator.destroy();

    if (this.distributionGenerator) {
      this.distributionGenerator.destroy();
    }

    if (this.eventMarkers) {
      this.eventMarkers.destroy();
    }
  }
}
