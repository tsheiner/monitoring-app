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
import {
  ChartConfig,
  Observation,
  Distribution,
  DistributionPoint,
  Event,
} from "./types";

export class ChartView {
  private core: ChartCore;
  private sharedRange: SharedRange;
  private dataTarget: DataTarget;
  private lineGenerator: LineGenerator;
  private distributionGenerator: DistributionRibbonGenerator | null = null;
  private eventMarkers: EventMarkersGenerator | null = null;
  private config: ChartConfig;
  private currentDistribution: Distribution | null = null;
  private distributionSeries: DistributionPoint[] = [];
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

    // Initialize data target
    this.dataTarget = new DataTarget();

    // Initialize distribution generator FIRST (so it renders behind line)
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

    // Initialize line generator AFTER distribution (so it renders on top)
    this.lineGenerator = new LineGenerator(
      this.core.getChartGroup(),
      config.colors.line,
    );
    this.lineGenerator.setScales(this.core.getXScale(), this.core.getYScale());

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
   * Load historical data.
   * This sets up the initial view with past data.
   * Clear existing data and set time range based on what's loaded.
   */
  loadHistoricalData(
    observations: Observation[],
    distribution: Distribution | null,
    distributionSeries?: DistributionPoint[],
  ): void {
    console.log(`Loading ${observations.length} historical observations`);
    console.log('Distribution data:', {
      hasDistribution: !!distribution,
      seriesLength: distributionSeries?.length || 0,
      showDistribution: this.config.showDistribution,
      generatorExists: !!this.distributionGenerator,
    });

    // Mark that we've loaded data - brush extent can now be properly set
    this.hasLoadedData = true;

    // Clear existing data first
    this.dataTarget.clear();

    // Store data
    this.dataTarget.push(observations);
    this.currentDistribution = distribution;
    this.distributionSeries = distributionSeries || [];

    // If no distribution series provided but we have data, compute it
    if (
      this.distributionSeries.length === 0 &&
      observations.length > 0 &&
      this.config.showDistribution
    ) {
      this.recomputeDistributionSeries();
    }

    // Ensure distribution generator exists if we need to show distributions
    // Recreate it to ensure fresh state with correct scales
    if (this.config.showDistribution) {
      if (this.distributionGenerator) {
        this.distributionGenerator.destroy();
      }
      this.distributionGenerator = new DistributionRibbonGenerator(
        this.core.getChartGroup(),
        this.config.colors.distribution,
      );
      this.distributionGenerator.setScales(
        this.core.getXScale(),
        this.core.getYScale(),
      );
    }

    // Update Y domain based on data
    const yDomain = this.dataTarget.getYDomain();
    this.core.updateYDomain(yDomain);

    // CRITICAL: Update brush range FIRST, before updateXDomain triggers onRangeChange
    // This ensures brushXScale domain is set correctly when brush selection is updated
    if (observations.length > 0) {
      const minTime = observations[0].timestamp;
      const maxTime = observations[observations.length - 1].timestamp;

      // Add buffer equal to the requested duration to allow sliding back in time
      const bufferDuration = this.durationSeconds;
      const brushStart = minTime - bufferDuration;

      // Ensure brush extends to at least the view range end (current time)
      const viewRange = this.sharedRange.getRange();
      const brushEnd = Math.max(maxTime, viewRange[1]);

      this.core.updateFullTimeRange([brushStart, brushEnd]);
    }

    // Now update X domain (which will trigger onRangeChange and updateBrushSelection)
    const range = this.sharedRange.getRange();
    this.core.updateXDomain(range);

    // Explicitly update brush selection to match the view range
    // This ensures proper initial positioning after brush extent is set
    this.core.updateBrushSelection(range);

    // Render
    this.render();
  }

  /**
   * Update chart colors (for metric switching).
   */
  updateColors(colors: { line?: string; distribution?: string }): void {
    // Update distribution first (if needed) to maintain z-order (behind line)
    if (colors.distribution && this.distributionGenerator) {
      this.config.colors.distribution = colors.distribution;
      // Destroy old generator before creating new one
      this.distributionGenerator.destroy();
      this.distributionGenerator = new DistributionRibbonGenerator(
        this.core.getChartGroup(),
        colors.distribution,
      );
      this.distributionGenerator.setScales(
        this.core.getXScale(),
        this.core.getYScale(),
      );
    }

    // Update line last to ensure it renders on top
    if (colors.line) {
      this.config.colors.line = colors.line;
      // Destroy old generator before creating new one
      if (this.lineGenerator) {
        this.lineGenerator.destroy();
      }
      this.lineGenerator = new LineGenerator(
        this.core.getChartGroup(),
        colors.line,
      );
      this.lineGenerator.setScales(
        this.core.getXScale(),
        this.core.getYScale(),
      );
    }

    // Re-render with new colors
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

      console.log(
        `Live data: ${new Date(now * 1000).toISOString()}, current range end: ${new Date(currentRange[1] * 1000).toISOString()}`,
      );

      // Only slide the window if the new observation is beyond the current range
      // This prevents jumping forward and losing historical data when live mode first starts
      if (now > currentRange[1]) {
        console.log(`Sliding window: ${now} > ${currentRange[1]}`);
        // Steady state: sliding window - keep duration constant
        // Move both edges forward so right edge = now
        const newRange: [number, number] = [now - this.durationSeconds, now];
        this.sharedRange.setRange(newRange);

        // Prune old data but keep buffer for sliding backwards
        // Keep data from (now - 2*duration) to allow full backward slide
        const pruneStart = newRange[0] - this.durationSeconds;
        this.dataTarget.pruneOutsideRange(pruneStart, newRange[1]);

        // Update brush context to show full available data range with buffer
        const allData = this.dataTarget.getAll();
        if (allData.length > 0) {
          const minTime = allData[0].timestamp;
          const maxTime = allData[allData.length - 1].timestamp;

          // Add buffer equal to requested duration for sliding
          const bufferDuration = this.durationSeconds;
          const brushStart = minTime - bufferDuration;

          // Extend brush to current time to prevent selection overflow
          const brushEnd = Math.max(maxTime, now);

          this.core.updateFullTimeRange([brushStart, brushEnd]);
        }
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

    // Recompute distribution from buffered data for live updates
    if (this.config.showDistribution && this.config.liveMode) {
      this.recomputeDistributionSeries();
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
    
    // Clear data before changing range to prevent rendering with stale data
    this.dataTarget.clear();
    this.distributionSeries = [];
    this.distributionGenerator.hide(); // Hide old distribution visualization
    
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

    // Only update brush selection after historical data is loaded and brush extent is set
    // This prevents brush from filling entire timeline during initialization
    if (this.hasLoadedData) {
      this.core.updateBrushSelection(range);
    }

    this.render();
  }

  /**
   * Recompute distribution series from buffered data.
   * Used for live updates when backend data is not available.
   */
  private recomputeDistributionSeries(): void {
    const range = this.sharedRange.getRange();
    const duration = range[1] - range[0];

    // Determine bucket size based on duration
    let bucketSize: number;
    if (duration <= 3600) {
      // <= 1 hour
      bucketSize = 300; // 5 minutes
    } else if (duration <= 14400) {
      // <= 4 hours
      bucketSize = 900; // 15 minutes
    } else if (duration <= 86400) {
      // <= 24 hours
      bucketSize = 3600; // 1 hour
    } else {
      bucketSize = 10800; // 3 hours
    }

    // Compute distribution for each bucket
    const newSeries: DistributionPoint[] = [];
    for (let t = range[0]; t < range[1]; t += bucketSize) {
      const bucketEnd = Math.min(t + bucketSize, range[1]);
      const dist = this.dataTarget.computeDistributionInRange(t, bucketEnd);

      if (dist) {
        newSeries.push({
          timestamp: t + bucketSize / 2, // Bucket center
          distribution: dist,
        });
      }
    }

    if (newSeries.length > 0) {
      // Extend distribution to edges by adding points at range boundaries
      // This ensures the distribution bands extend to the full time range
      const firstDist = newSeries[0].distribution;
      const lastDist = newSeries[newSeries.length - 1].distribution;

      this.distributionSeries = [
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
    const observations = this.dataTarget.getInRange(range[0], range[1]);

    console.log(`Rendering ${observations.length} observations in range`);

    // Render line
    this.lineGenerator.update(observations, range);

    // Render distribution using time-bucketed series if available
    if (this.distributionGenerator && this.config.showDistribution) {
      console.log('Attempting to render distribution:', {
        seriesLength: this.distributionSeries?.length || 0,
        hasCurrentDistribution: !!this.currentDistribution,
      });
      
      if (this.distributionSeries && this.distributionSeries.length > 0) {
        // Use time-varying distribution series
        const distributionInRange = this.distributionSeries.filter(
          (dp) => dp.timestamp >= range[0] && dp.timestamp <= range[1],
        );

        console.log(`Distribution in range: ${distributionInRange.length} points`);

        if (distributionInRange.length > 0) {
          this.distributionGenerator.update(distributionInRange, range);
        } else {
          console.log('No distribution points in range, hiding');
          this.distributionGenerator.hide();
        }
      } else if (this.currentDistribution) {
        // Fallback to static distribution (for backwards compatibility)
        // Create distribution points spanning visible range
        const numPoints = 20;
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
   * Handle brush selection for range zooming.
   */
  private handleBrushSelection(range: [number, number]): void {
    // Disable live mode when user zooms
    this.config.liveMode = false;

    // Update duration
    this.durationSeconds = range[1] - range[0];

    // Update the shared range (this triggers onRangeChange which updates X domain and renders)
    this.sharedRange.setRange(range);

    // Notify that a new range was selected so data can be fetched
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
    this.lineGenerator.destroy();

    if (this.distributionGenerator) {
      this.distributionGenerator.destroy();
    }

    if (this.eventMarkers) {
      this.eventMarkers.destroy();
    }
  }
}
