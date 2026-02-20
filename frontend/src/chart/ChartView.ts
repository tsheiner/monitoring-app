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
import * as d3 from "d3";
import {
  ChartConfig,
  Observation,
  DistributionPoint,
  Event,
  BaselineResponse,
} from "./types";

interface MetricData {
  dataTarget: DataTarget;
  lineGenerator: LineGenerator;
  distributionGenerator: DistributionRibbonGenerator | null;
  baseline: BaselineResponse | null;
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

  // Crosshair elements
  private crosshairGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private crosshairVertical: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
  >;
  private crosshairHorizontal: d3.Selection<
    SVGLineElement,
    unknown,
    null,
    undefined
  >;
  private nearestMetric: string | null = null;

  // Tooltip elements
  private tooltipElement: HTMLDivElement;
  private activeMetric: string | null = null;
  private activeMetricTimer: number | null = null;
  private readonly HYSTERESIS_MS = 150; // Delay before switching active metric

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
        this.core.getUnclippedChartGroup(), // Use unclipped group so markers aren't cut off
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

    // Initialize crosshair
    this.crosshairGroup = this.core
      .getUnclippedChartGroup()
      .append("g")
      .attr("class", "crosshair-group")
      .style("display", "none");

    this.crosshairVertical = this.crosshairGroup
      .append("line")
      .attr("class", "crosshair-vertical")
      .attr("stroke", "#888")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4 4");

    this.crosshairHorizontal = this.crosshairGroup
      .append("line")
      .attr("class", "crosshair-horizontal")
      .attr("stroke", "#888")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4 4");

    // Initialize tooltip
    this.tooltipElement = document.createElement("div");
    this.tooltipElement.className = "chart-tooltip";
    this.tooltipElement.style.position = "absolute";
    this.tooltipElement.style.display = "none";
    this.tooltipElement.style.pointerEvents = "none";
    this.tooltipElement.style.backgroundColor = "rgba(0, 0, 0, 0.9)";
    this.tooltipElement.style.color = "#fff";
    this.tooltipElement.style.padding = "12px";
    this.tooltipElement.style.borderRadius = "4px";
    this.tooltipElement.style.fontSize = "13px";
    this.tooltipElement.style.zIndex = "1000";
    this.tooltipElement.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
    this.tooltipElement.style.maxWidth = "300px";
    container.appendChild(this.tooltipElement);

    // Add mouse event handlers for crosshair
    this.setupCrosshairHandlers();
  }

  /**
   * Setup crosshair mouse event handlers.
   */
  private setupCrosshairHandlers(): void {
    const svg = this.core.getSVG();

    svg.on("mousemove", (event: MouseEvent) => {
      // Get mouse position relative to the SVG element
      const svgRect = (svg.node() as SVGSVGElement).getBoundingClientRect();
      const x = event.clientX - svgRect.left - this.config.margin.left;
      const y = event.clientY - svgRect.top - this.config.margin.top;

      this.updateCrosshair(x, y);
    });

    svg.on("mouseleave", () => {
      this.hideCrosshair();
    });
  }

  /**
   * Update crosshair position and find nearest metric.
   */
  private updateCrosshair(x: number, y: number): void {
    const chartWidth =
      this.config.width - this.config.margin.left - this.config.margin.right;
    const chartHeight =
      this.config.height - this.config.margin.top - this.config.margin.bottom;

    // Check if cursor is within plot area
    if (x < 0 || x > chartWidth || y < 0 || y > chartHeight) {
      this.hideCrosshair();
      return;
    }

    // Show crosshair
    this.crosshairGroup.style("display", null);

    // Update vertical line (full height of chart)
    this.crosshairVertical
      .attr("x1", x)
      .attr("y1", 0)
      .attr("x2", x)
      .attr("y2", chartHeight);

    // Update horizontal line (full width of chart)
    this.crosshairHorizontal
      .attr("x1", 0)
      .attr("y1", y)
      .attr("x2", chartWidth)
      .attr("y2", y);

    // Find nearest metric at this position
    this.findNearestMetric(x, y);

    // Update and show tooltip
    this.updateTooltip(x, y);
  }

  /**
   * Hide the crosshair and tooltip.
   */
  private hideCrosshair(): void {
    this.crosshairGroup.style("display", "none");
    this.nearestMetric = null;
    this.tooltipElement.style.display = "none";

    // Clear active metric timer if hovering away
    if (this.activeMetricTimer !== null) {
      clearTimeout(this.activeMetricTimer);
      this.activeMetricTimer = null;
    }
  }

  /**
   * Find the nearest metric to the cursor position.
   */
  private findNearestMetric(x: number, y: number): void {
    if (this.metrics.size === 0) {
      this.nearestMetric = null;
      return;
    }

    const xScale = this.core.getXScale();
    const yScale = this.core.getYScale();

    // Convert pixel coordinates to data coordinates
    const cursorTime = xScale.invert(x).getTime() / 1000; // Unix timestamp
    const cursorValue = yScale.invert(y);

    let nearestMetricName: string | null = null;
    let minDistance = Infinity;

    // For each metric, find the closest point in time and compute distance
    for (const [metricName, metricData] of this.metrics.entries()) {
      const observations = metricData.dataTarget.getAll();

      if (observations.length === 0) {
        continue;
      }

      // Find observation closest to cursor time using binary search
      let closestObs: Observation | null = null;
      let minTimeDiff = Infinity;

      for (const obs of observations) {
        const timeDiff = Math.abs(obs.timestamp - cursorTime);
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          closestObs = obs;
        }
      }

      if (!closestObs) {
        continue;
      }

      // Compute vertical distance in pixel space (Y direction only)
      const obsPixelY = yScale(closestObs.value);
      const distance = Math.abs(obsPixelY - y);

      if (distance < minDistance) {
        minDistance = distance;
        nearestMetricName = metricName;
      }
    }

    this.nearestMetric = nearestMetricName;
  }

  /**
   * Get the currently nearest metric to the cursor.
   */
  getNearestMetric(): string | null {
    return this.nearestMetric;
  }

  /**
   * Update and show the tooltip at the cursor position.
   */
  private updateTooltip(x: number, y: number): void {
    if (this.metrics.size === 0) {
      this.tooltipElement.style.display = "none";
      return;
    }

    const xScale = this.core.getXScale();
    const cursorTime = xScale.invert(x).getTime() / 1000;

    // Collect values for all visible metrics at cursor time
    const metricsAtCursor: Array<{
      name: string;
      value: number | null;
      color: string;
      classifiers?: Record<string, { value: number; status: string }>;
    }> = [];

    for (const [metricName, metricData] of this.metrics.entries()) {
      const observations = metricData.dataTarget.getAll();

      if (observations.length === 0) {
        continue;
      }

      // Find observation closest to cursor time
      let closestObs: Observation | null = null;
      let minTimeDiff = Infinity;

      for (const obs of observations) {
        const timeDiff = Math.abs(obs.timestamp - cursorTime);
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          closestObs = obs;
        }
      }

      if (closestObs) {
        metricsAtCursor.push({
          name: metricName,
          value: closestObs.value,
          color: metricData.color,
          classifiers: closestObs.classifiers,
        });
      }
    }

    if (metricsAtCursor.length === 0) {
      this.tooltipElement.style.display = "none";
      return;
    }

    // Handle active metric hysteresis
    this.updateActiveMetric();

    // Build tooltip HTML
    const tooltipHtml = this.buildTooltipContent(metricsAtCursor);
    this.tooltipElement.innerHTML = tooltipHtml;

    // Position tooltip
    const svgRect = (
      this.core.getSVG().node() as SVGSVGElement
    ).getBoundingClientRect();
    const tooltipX = svgRect.left + this.config.margin.left + x + 15;
    const tooltipY = svgRect.top + this.config.margin.top + y + 15;

    this.tooltipElement.style.left = `${tooltipX}px`;
    this.tooltipElement.style.top = `${tooltipY}px`;
    this.tooltipElement.style.display = "block";
  }

  /**
   * Update active metric with hysteresis to avoid rapid switching.
   */
  private updateActiveMetric(): void {
    // If nearest metric hasn't changed, keep active metric unchanged
    if (this.nearestMetric === this.activeMetric) {
      // Clear any pending timer
      if (this.activeMetricTimer !== null) {
        clearTimeout(this.activeMetricTimer);
        this.activeMetricTimer = null;
      }
      return;
    }

    // If nearest metric changed, start hysteresis timer
    if (this.activeMetricTimer !== null) {
      // Timer already running, wait for it to complete
      return;
    }

    // Start hysteresis timer
    this.activeMetricTimer = window.setTimeout(() => {
      this.activeMetric = this.nearestMetric;
      this.activeMetricTimer = null;
    }, this.HYSTERESIS_MS);
  }

  /**
   * Build tooltip HTML content showing all metrics and expanded classifiers for active metric.
   */
  private buildTooltipContent(
    metricsAtCursor: Array<{
      name: string;
      value: number | null;
      color: string;
      classifiers?: Record<string, { value: number; status: string }>;
    }>,
  ): string {
    let html = '<div style="font-size: 12px;">';

    for (const metric of metricsAtCursor) {
      const isActive = metric.name === this.activeMetric;
      const activeClass = isActive ? " active" : "";

      html += `<div class="tooltip-metric${activeClass}" style="margin-bottom: 8px;">`;
      html += `<div style="display: flex; align-items: center; margin-bottom: 4px;">`;
      html += `<span style="display: inline-block; width: 8px; height: 8px; background-color: ${metric.color}; border-radius: 50%; margin-right: 6px;"></span>`;
      html += `<strong>${metric.name}</strong>: ${metric.value !== null ? metric.value.toFixed(2) : "N/A"}`;
      html += `</div>`;

      // Expand classifiers only for the active metric
      if (isActive && metric.classifiers) {
        const classifiers = Object.entries(metric.classifiers);

        if (classifiers.length > 0) {
          // Find primary classifier (worst status, or highest weight*deviation)
          const primaryClassifier = this.findPrimaryClassifier(
            metric.classifiers,
          );

          html +=
            '<div style="margin-left: 14px; font-size: 11px; opacity: 0.9;">';
          for (const [name, data] of classifiers) {
            const statusColor =
              data.status === "red"
                ? "#f44336"
                : data.status === "yellow"
                  ? "#ff9800"
                  : "#4caf50";

            const isPrimary = name === primaryClassifier;
            const primaryIndicator = isPrimary ? "▸ " : "";
            const primaryStyle = isPrimary ? "font-weight: bold;" : "";

            html += `<div class="tooltip-classifier ${isPrimary ? "primary" : ""}" style="${primaryStyle}">`;
            html += `${primaryIndicator}${name}: ${data.value.toFixed(2)} `;
            html += `<span style="color: ${statusColor};">●</span>`;
            html += `</div>`;
          }
          html += "</div>";
        }
      }

      html += `</div>`;
    }

    html += "</div>";
    return html;
  }

  /**
   * Find the primary classifier for highlighting (worst status, tie-break by value deviation from 1.0).
   */
  private findPrimaryClassifier(
    classifiers: Record<string, { value: number; status: string }>,
  ): string | null {
    if (Object.keys(classifiers).length === 0) {
      return null;
    }

    const statusPriority = { red: 3, yellow: 2, green: 1 };

    let primaryName: string | null = null;
    let worstPriority = 0;
    let maxDeviation = 0;

    for (const [name, data] of Object.entries(classifiers)) {
      const priority =
        statusPriority[data.status as keyof typeof statusPriority] || 0;
      const deviation = Math.abs(1.0 - data.value);

      if (
        priority > worstPriority ||
        (priority === worstPriority && deviation > maxDeviation)
      ) {
        primaryName = name;
        worstPriority = priority;
        maxDeviation = deviation;
      }
    }

    return primaryName;
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
      baseline: null,
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
  loadHistoricalData(metricName: string, observations: Observation[]): void {
    const metricData = this.metrics.get(metricName);
    if (!metricData) {
      console.warn(`Cannot load data for unknown metric: ${metricName}`);
      return;
    }

    console.log(
      `Loading ${observations.length} observations for ${metricName}`,
    );

    // Debug: Log actual min/max of incoming observations
    if (observations.length > 0) {
      const obsValues = observations.map((o) => o.value);
      const obsMin = Math.min(...obsValues);
      const obsMax = Math.max(...obsValues);
      const firstTs = observations[0].timestamp;
      const lastTs = observations[observations.length - 1].timestamp;

      console.log(
        `📥 Incoming observations: min=${obsMin.toFixed(2)}, max=${obsMax.toFixed(2)}, first 3: [${obsValues
          .slice(0, 3)
          .map((v) => v.toFixed(2))
          .join(", ")}], last 3: [${obsValues
          .slice(-3)
          .map((v) => v.toFixed(2))
          .join(", ")}]`,
      );
      console.log(
        `⏰ Time range: data [${new Date(firstTs * 1000).toISOString()} to ${new Date(lastTs * 1000).toISOString()}]`,
      );
    }

    metricData.dataTarget.push(observations);

    // Debug: Check for suspicious jumps in data
    if (observations.length > 1) {
      const values = observations.map((o) => o.value);
      const maxJump = Math.max(
        ...values.map((v, i) => (i > 0 ? Math.abs(v - values[i - 1]) : 0)),
      );
      if (maxJump > 5) {
        console.warn(
          `⚠️ Large value jump detected: ${maxJump.toFixed(2)} in ${metricName}. First 3: ${values.slice(0, 3).map((v) => v.toFixed(2))}, Last 3: ${values.slice(-3).map((v) => v.toFixed(2))}`,
        );
      }
    }

    // Update buffered range for this metric
    if (observations.length > 0) {
      const newStart = observations[0].timestamp;
      const newEnd = observations[observations.length - 1].timestamp;

      if (metricData.bufferedRange) {
        // Expand existing range
        metricData.bufferedRange = [
          Math.min(metricData.bufferedRange[0], newStart),
          Math.max(metricData.bufferedRange[1], newEnd),
        ];
      } else {
        // Initialize range
        metricData.bufferedRange = [newStart, newEnd];
      }
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
        console.log(
          `🔍 Before Y-domain update: current=[${metricData.normalizedYDomain[0].toFixed(2)}, ${metricData.normalizedYDomain[1].toFixed(2)}], new data=[${minVal.toFixed(2)}, ${maxVal.toFixed(2)}]`,
        );

        if (metricData.normalizedYDomain[0] === Infinity) {
          // First time: initialize with actual data range
          metricData.normalizedYDomain = [minVal, maxVal];
          console.log(
            `✅ First time initialization: [${minVal.toFixed(2)}, ${maxVal.toFixed(2)}]`,
          );
        } else {
          // Expand domain to include new data (but never shrink)
          const oldDomain = [...metricData.normalizedYDomain];
          metricData.normalizedYDomain = [
            Math.min(metricData.normalizedYDomain[0], minVal),
            Math.max(metricData.normalizedYDomain[1], maxVal),
          ];
          const changed =
            oldDomain[0] !== metricData.normalizedYDomain[0] ||
            oldDomain[1] !== metricData.normalizedYDomain[1];
          if (changed) {
            console.log(
              `🔄 Y-domain expanded: [${oldDomain[0].toFixed(2)}, ${oldDomain[1].toFixed(2)}] → [${metricData.normalizedYDomain[0].toFixed(2)}, ${metricData.normalizedYDomain[1].toFixed(2)}]`,
            );
          } else {
            console.log(
              `✓ Y-domain unchanged (new data within existing range)`,
            );
          }
        }

        console.log(
          `Metric ${metricName} Y domain: [${metricData.normalizedYDomain[0].toFixed(2)}, ${metricData.normalizedYDomain[1].toFixed(2)}] (from ${allBufferedData.length} buffered points, min: ${minVal.toFixed(2)}, max: ${maxVal.toFixed(2)})`,
        );
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
    // Debug: log call stack to see WHO is calling this
    console.log(
      "📊 updateGlobalYDomain called from:",
      new Error().stack?.split("\n")[2]?.trim(),
    );

    // #region agent log
    const currentRange = this.sharedRange.getRange();
    const allMetricsData = Array.from(this.metrics.entries()).map(
      ([name, data]) => ({
        name,
        bufferCount: data.dataTarget.getAll().length,
        domain: data.normalizedYDomain,
      }),
    );
    fetch("http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "ChartView.ts:updateGlobalYDomain",
        message: "Y-domain recalculation",
        data: {
          metricCount: this.metrics.size,
          visibleRange: currentRange,
          allMetricsData,
        },
        timestamp: Date.now(),
        runId: "pan-rescale-debug",
        hypothesisId: "H3",
      }),
    }).catch(() => {});
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

    // Check if this new observation EXPANDS the Y-domain
    const oldDomain = metricData.normalizedYDomain;
    const domainExpanded =
      observation.value < oldDomain[0] || observation.value > oldDomain[1];

    // Only update Y-domain if it actually expanded
    if (domainExpanded) {
      metricData.normalizedYDomain = [
        Math.min(oldDomain[0], observation.value),
        Math.max(oldDomain[1], observation.value),
      ];
      console.log(
        `📈 Y-domain EXPANDED by live data: [${oldDomain[0].toFixed(2)}, ${oldDomain[1].toFixed(2)}] → [${metricData.normalizedYDomain[0].toFixed(2)}, ${metricData.normalizedYDomain[1].toFixed(2)}]`,
      );
      this.updateGlobalYDomain();
    }

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

    // Baseline distributions are periodic and don't need sliding updates

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

    // Update shared range without clearing buffers
    this.sharedRange.setRange([start, end]);

    // DON'T update Y domain here - it only changes when NEW data is loaded,
    // not when panning. This prevents Y-axis jumping during pan.
    // Y domain is updated in loadHistoricalData() and appendLiveData() only.

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
   * Set baseline distribution for a metric.
   * Caches the 24-hour baseline which will be used to generate distribution ribbons.
   */
  setBaseline(metricName: string, baseline: BaselineResponse): void {
    const metricData = this.metrics.get(metricName);
    if (!metricData) {
      console.warn(`Cannot set baseline for unknown metric: ${metricName}`);
      return;
    }

    metricData.baseline = baseline;
    console.log(
      `Set baseline for ${metricName} with ${baseline.hourly_distributions.length} hourly distributions`,
    );

    this.render();
  }

  /**
   * Generate distribution points from baseline for the current time range.
   * Maps the periodic 24-hour baseline to the visible time range,
   * interpolating between hourly bins for smooth transitions.
   */
  private generateBaselineDistribution(
    baseline: BaselineResponse,
    range: [number, number],
  ): DistributionPoint[] {
    const duration = range[1] - range[0];
    const numPoints = Math.min(100, Math.max(24, Math.floor(duration / 600))); // 1 point per 10 minutes, capped at 100
    const step = duration / numPoints;
    const distributionPoints: DistributionPoint[] = [];

    // Build a lookup map for fast access
    const hourMap = new Map<
      number,
      (typeof baseline.hourly_distributions)[0]
    >();
    for (const hd of baseline.hourly_distributions) {
      hourMap.set(hd.hour, hd);
    }

    const percentileKeys = [
      "p1",
      "p5",
      "p10",
      "p25",
      "p50",
      "p75",
      "p90",
      "p95",
      "p99",
      "mean",
      "stddev",
    ] as const;

    for (let i = 0; i <= numPoints; i++) {
      const timestamp = range[0] + i * step;
      const date = new Date(timestamp * 1000);
      const hour = date.getHours();
      const minuteFraction = (date.getMinutes() + date.getSeconds() / 60) / 60; // 0..1 within the hour

      const currentDist = hourMap.get(hour);
      const nextHour = (hour + 1) % 24;
      const nextDist = hourMap.get(nextHour);

      if (currentDist && nextDist) {
        // Interpolate between this hour and the next for smooth transitions
        const t = minuteFraction;
        const interpolated: Record<string, number> = {};
        for (const key of percentileKeys) {
          const a =
            (currentDist.distribution as Record<string, number>)[key] ?? 0;
          const b = (nextDist.distribution as Record<string, number>)[key] ?? 0;
          interpolated[key] = a + (b - a) * t;
        }
        // Preserve count from current hour
        interpolated["count"] =
          (currentDist.distribution as Record<string, number>)["count"] ?? 0;

        distributionPoints.push({
          timestamp,
          distribution:
            interpolated as unknown as DistributionPoint["distribution"],
        });
      } else if (currentDist) {
        // No next hour available, use current as-is
        distributionPoints.push({
          timestamp,
          distribution: currentDist.distribution,
        });
      }
    }

    return distributionPoints;
  }

  /**
   * Render all generators.
   */
  private render(): void {
    const range = this.sharedRange.getRange();

    // Render each metric
    for (const [metricName, metricData] of this.metrics) {
      // Get ALL buffered data (not just visible range) for pre-rendering
      const allObservations = metricData.dataTarget.getAll();

      if (this.metrics.size > 1) {
        // Multiple metrics: normalize to 0-100
        const normalizedObs = allObservations.map((obs) => ({
          timestamp: obs.timestamp,
          value: this.normalizeValue(obs.value, metricData.normalizedYDomain),
        }));
        metricData.lineGenerator.update(normalizedObs, range);

        // Hide distribution for multi-metric view
        if (metricData.distributionGenerator) {
          metricData.distributionGenerator.hide();
        }
      } else {
        // Single metric: use actual values for ALL buffered data
        metricData.lineGenerator.update(allObservations, range);

        // FIX C: Explicitly show distribution when in single-metric mode.
        // It may have been hidden during a prior multi-metric render.
        // Render distribution for single metric
        if (metricData.distributionGenerator && this.config.showDistribution) {
          metricData.distributionGenerator.show();

          if (metricData.baseline) {
            // Generate distribution points from 24-hour baseline
            const distributionPoints = this.generateBaselineDistribution(
              metricData.baseline,
              range,
            );
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
    }
  }

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
