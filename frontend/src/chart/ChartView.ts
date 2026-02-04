/**
 * ChartView - Main chart orchestrator.
 * 
 * Implements juttle-viz inspired architecture with:
 * - Duration-based display (shows last N seconds)
 * - Growth phase: line grows left→right until duration is filled
 * - Steady state: sliding window where right edge = now
 * - Automatic downsampling based on point density
 */

import { ChartCore } from './ChartCore';
import { SharedRange } from './SharedRange';
import { DataTarget } from './DataTarget';
import { LineGenerator } from './generators/LineGenerator';
import { DistributionRibbonGenerator } from './generators/DistributionRibbonGenerator';
import { EventMarkersGenerator } from './generators/EventMarkersGenerator';
import { ChartConfig, Observation, Distribution, Event } from './types';

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
      config.colors.line
    );
    this.lineGenerator.setScales(this.core.getXScale(), this.core.getYScale());
    
    // Initialize distribution generator if enabled
    if (config.showDistribution) {
      this.distributionGenerator = new DistributionRibbonGenerator(
        this.core.getChartGroup(),
        config.colors.distribution
      );
      this.distributionGenerator.setScales(this.core.getXScale(), this.core.getYScale());
    }
    
    // Initialize event markers if enabled
    if (config.showEvents) {
      this.eventMarkers = new EventMarkersGenerator(
        this.core.getChartGroup(),
        config.colors.event,
        config.colors.eventHover
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
   * X-axis is already set to full range, we just add the data points.
   */
  loadHistoricalData(observations: Observation[], distribution: Distribution | null): void {
    console.log(`Loading ${observations.length} historical observations`);
    
    // Store data
    this.dataTarget.push(observations);
    this.currentDistribution = distribution;
    
    // Update Y domain based on data
    const yDomain = this.dataTarget.getYDomain();
    this.core.updateYDomain(yDomain);
    
    // X-axis is already set to full range in constructor
    // Just render the data we have
    this.render();
  }
  
  /**
   * Append live observation.
   * In live mode, this slides the window forward.
   */
  appendLiveData(observation: Observation): void {
    this.dataTarget.push([observation]);
    
    // Update Y domain if needed
    const yDomain = this.dataTarget.getYDomain();
    this.core.updateYDomain(yDomain);
    
    // If in live mode, slide the window forward
    if (this.config.liveMode) {
      const now = observation.timestamp;
      
      // Steady state: sliding window - keep duration constant
      // Move both edges forward so right edge = now
      this.sharedRange.setRange([now - this.durationSeconds, now]);
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
   */
  setTimeRange(durationSeconds: number): void {
    this.durationSeconds = durationSeconds;
    const now = Math.floor(Date.now() / 1000);
    
    // Always set range to [now - duration, now]
    // This keeps the right edge at NOW
    this.chartStartTime = now - durationSeconds;
    this.sharedRange.setRange([this.chartStartTime, now]);
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
        this.config.colors.distribution
      );
      this.distributionGenerator.setScales(this.core.getXScale(), this.core.getYScale());
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
    console.log(`Range changed: ${new Date(range[0] * 1000).toISOString()} to ${new Date(range[1] * 1000).toISOString()}`);
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
    if (this.distributionGenerator && this.currentDistribution && this.config.showDistribution) {
      // Create distribution points spanning the visible range
      const distributionPoints = [
        { timestamp: range[0], distribution: this.currentDistribution },
        { timestamp: range[1], distribution: this.currentDistribution }
      ];
      this.distributionGenerator.update(distributionPoints, range);
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
