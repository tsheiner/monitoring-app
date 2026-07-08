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
import { buildTrendDisplay } from "./trend/aggregateTrend";
import * as d3 from "d3";
import {
  ChartConfig,
  Observation,
  DistributionPoint,
  Event,
  BaselineResponse,
  STATUS_ZONE_COLORS,
  TrendPoint,
} from "./types";

interface MetricData {
  dataTarget: DataTarget;
  lineGenerator: LineGenerator;
  distributionGenerator: DistributionRibbonGenerator | null;
  baseline: BaselineResponse | null;
  color: string;
  label: string; // Human-readable display label (FD-023)
  normalizedYDomain: [number, number]; // For independent normalization
  bufferedRange: [number, number] | null; // Track what time range is buffered
  displayData: TrendPoint[]; // Derived render/hover series for the current range
}

export class ChartView {
  private core: ChartCore;
  private sharedRange: SharedRange;
  private metrics: Map<string, MetricData> = new Map();
  private classifierBaselines: Map<string, BaselineResponse> = new Map();
  private eventMarkers: EventMarkersGenerator | null = null;
  private config: ChartConfig;
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
  private crosshairDots: d3.Selection<SVGGElement, unknown, null, undefined>;
  private nearestMetric: string | null = null;
  private legendOrder: string[] = [];

  // Tooltip elements
  private tooltipElement: HTMLDivElement;
  private activeMetric: string | null = null;
  private activeMetricTimer: number | null = null;
  private readonly HYSTERESIS_MS = 150; // Delay before switching active metric

  // FD-025: Metric unit suffixes and decimal precision maps
  private static readonly METRIC_UNITS: Record<string, string> = {
    time_to_connect: " ms",
    throughput: " Mbps",
    coverage: " dBm",
    capacity: "%",
    roaming: " ms",
    successful_connects: "%",
    ap_health: "",
  };

  private static readonly METRIC_DECIMALS: Record<string, number> = {
    time_to_connect: 0,
    throughput: 0,
    coverage: 0,
    capacity: 1,
    roaming: 0,
    successful_connects: 1,
    ap_health: 0,
  };

  // Interaction state
  private isPanning: boolean = false;

  // Cache last rendered state so hysteresis timer can re-render when mouse is stationary
  private lastMetricsAtCursor: Array<{
    name: string;
    label: string;
    value: number | null;
    color: string;
    classifiers?: Record<string, { value: number; status: string }>;
    trendKind?: "raw" | "bucket";
    bucketStart?: number;
    bucketEnd?: number;
    sampleCount?: number;
  }> = [];
  private lastCursorTimeSec: number | undefined;
  // Persist most recent classifiers by metric so tooltip details don't disappear
  // when hovered timestamp lands on an observation without classifiers.
  private latestClassifiersByMetric: Map<
    string,
    Record<string, { value: number; status: string }>
  > = new Map();

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
      .attr("stroke", "#656C75")
      .attr("stroke-width", 2);
    // No stroke-dasharray — must be solid per redesign spec

    // Container for highlighted dots at trace intersections (FD-022)
    this.crosshairDots = this.crosshairGroup
      .append("g")
      .attr("class", "crosshair-dots");

    // Initialize tooltip — styled to Figma spec
    this.tooltipElement = document.createElement("div");
    this.tooltipElement.className = "chart-tooltip";
    this.tooltipElement.style.position = "absolute";
    this.tooltipElement.style.display = "none";
    this.tooltipElement.style.pointerEvents = "none";
    this.tooltipElement.style.backgroundColor = "#2C3440";
    this.tooltipElement.style.color = "#F7F7F7";
    this.tooltipElement.style.padding = "12px 16px";
    this.tooltipElement.style.borderRadius = "6px";
    this.tooltipElement.style.border = "2px solid #656C75";
    this.tooltipElement.style.fontSize = "14px";
    this.tooltipElement.style.fontFamily = "'Inter', sans-serif";
    this.tooltipElement.style.zIndex = "1000";
    this.tooltipElement.style.width = "292px";
    this.tooltipElement.style.boxSizing = "border-box";
    this.tooltipElement.style.flexDirection = "column";
    this.tooltipElement.style.gap = "6px";
    this.tooltipElement.style.boxShadow = "0px 4px 12px rgba(0,0,0,0.18)";
    container.appendChild(this.tooltipElement);

    // Add mouse event handlers for crosshair
    this.setupCrosshairHandlers();

    // Setup pan detection to suppress crosshair/tooltip during drag
    this.setupPanDetection();
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
   * Setup pan detection to suppress crosshair/tooltip during drag.
   */
  private setupPanDetection(): void {
    const zoom = this.core.getZoomBehavior();

    // Listen to zoom start event to detect beginning of pan/zoom
    zoom.on("start", () => {
      this.isPanning = true;
      // Hide crosshair and tooltip when pan starts
      this.hideCrosshair();
    });

    // Listen to zoom end event to re-enable hover
    zoom.on("end", () => {
      this.isPanning = false;
    });
  }

  /**
   * Update crosshair position and find nearest metric.
   */
  private updateCrosshair(x: number, y: number): void {
    // Suppress crosshair during pan/zoom
    if (this.isPanning) {
      return;
    }

    const chartWidth =
      this.config.width - this.config.margin.left - this.config.margin.right;
    const chartHeight =
      this.config.height - this.config.margin.top - this.config.margin.bottom;

    // Check if cursor is within plot area
    if (x < 0 || x > chartWidth || y < 0 || y > chartHeight) {
      this.hideCrosshair();
      return;
    }

    if (this.isLiveEdgeHover(x, chartWidth)) {
      this.hideCrosshair();
      return;
    }

    // Show crosshair
    this.crosshairGroup.style("display", null);

    // Update vertical line (full height of chart) — solid, no horizontal
    this.crosshairVertical
      .attr("x1", x)
      .attr("y1", 0)
      .attr("x2", x)
      .attr("y2", chartHeight);

    // Find nearest metric first so special dot styling is current this frame
    this.findNearestMetric(x, y);

    // Update highlighted dots on each visible metric trace (FD-022)
    this.updateCrosshairDots(x);

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

  private isLiveEdgeHover(x: number, chartWidth: number): boolean {
    const [rangeStart, rangeEnd] = this.sharedRange.getRange();
    const duration = rangeEnd - rangeStart;
    if (duration <= 0 || chartWidth <= 0) return false;

    const now = Date.now() / 1000;
    const rangeEndsNearNow =
      this.config.liveMode || rangeEnd >= now - Math.max(60, duration * 0.01);
    if (!rangeEndsNearNow) return false;

    return x / chartWidth >= 0.95;
  }

  private getHoverData(metricData: MetricData): TrendPoint[] | Observation[] {
    return metricData.displayData.length > 0
      ? metricData.displayData
      : metricData.dataTarget.getAll();
  }

  /**
   * Update highlighted dots at each metric trace's y-position for cursor x (FD-022).
   * Dots are filled circles with radius 4 in the metric's trace color.
   */
  private updateCrosshairDots(x: number): void {
    const xScale = this.core.getXScale();
    const yScale = this.core.getYScale();
    const cursorTime = xScale.invert(x).getTime() / 1000;

    // Collect dot data for each visible metric
    const dotData: Array<{
      metricName: string;
      y: number;
      color: string;
      closestTs: number;
      timeDiffSec: number;
    }> = [];

    for (const [metricName, metricData] of this.metrics.entries()) {
      const observations = this.getHoverData(metricData);
      if (observations.length === 0) continue;

      const pointAtCursor = this.getPointAtTime(observations, cursorTime);
      if (!pointAtCursor) continue;

      // Compute normalized value for multi-metric display
      let displayValue = pointAtCursor.value;
      if (this.metrics.size > 1) {
        displayValue = this.normalizeValue(
          pointAtCursor.value,
          metricData.normalizedYDomain,
        );
      }

      dotData.push({
        metricName,
        y: yScale(displayValue),
        color: metricData.color,
        closestTs: pointAtCursor.closestObs.timestamp,
        timeDiffSec: pointAtCursor.timeDiffSec,
      });
    }

    // Bind data to dot elements using D3 enter/update/exit
    const dots = this.crosshairDots
      .selectAll<SVGCircleElement, (typeof dotData)[0]>(".crosshair-dot")
      .data(dotData, (d) => d.metricName);

    // Helper: is this dot for the nearest metric?
    const isNearest = (d: (typeof dotData)[0]) =>
      d.metricName === this.nearestMetric;

    // Enter: create new dots — knockout border effect, nearest gets highlight ring
    dots
      .enter()
      .append("circle")
      .attr("class", "crosshair-dot")
      .attr("r", 4)
      .attr("fill", (d) => d.color)
      .attr("stroke", (d) => (isNearest(d) ? "#C1C6CC" : "#2A2A2A"))
      .attr("stroke-width", 3)
      .attr("cx", x)
      .attr("cy", (d) => d.y);

    // Update: reposition existing dots and re-apply styles (nearestMetric may have changed)
    dots
      .attr("r", 4)
      .attr("fill", (d) => d.color)
      .attr("stroke", (d) => (isNearest(d) ? "#C1C6CC" : "#2A2A2A"))
      .attr("stroke-width", 3)
      .attr("cx", x)
      .attr("cy", (d) => d.y);

    // Exit: remove dots for metrics no longer visible
    dots.exit().remove();
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

    let nearestMetricName: string | null = null;
    let minDistance = Infinity;
    const distanceBreakdown: Array<{
      metricName: string;
      rawDistance: number;
      normalizedDistance: number | null;
      closestValue: number;
      closestTs: number;
      timeDiffSec: number;
    }> = [];

    // For each metric, find the closest point in time and compute distance
    for (const [metricName, metricData] of this.metrics.entries()) {
      const observations = this.getHoverData(metricData);

      if (observations.length === 0) {
        continue;
      }

      const pointAtCursor = this.getPointAtTime(observations, cursorTime);
      if (!pointAtCursor) {
        continue;
      }

      // In multi-metric mode traces are rendered in normalized space (0-100),
      // so nearest-metric distance must also be measured in that same space.
      const displayValue =
        this.metrics.size > 1
          ? this.normalizeValue(
              pointAtCursor.value,
              metricData.normalizedYDomain,
            )
          : pointAtCursor.value;
      const obsPixelY = yScale(displayValue);
      const distance = Math.abs(obsPixelY - y);

      // Keep raw-distance in logs for diagnosis, but do not use it for selection in multi-metric mode.
      const rawDistance = Math.abs(yScale(pointAtCursor.value) - y);
      const normalizedDistance =
        this.metrics.size > 1 ? Math.abs(yScale(displayValue) - y) : null;
      distanceBreakdown.push({
        metricName,
        rawDistance,
        normalizedDistance,
        closestValue: pointAtCursor.value,
        closestTs: pointAtCursor.closestObs.timestamp,
        timeDiffSec: pointAtCursor.timeDiffSec,
      });

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
      label: string; // FD-023: human-readable display label
      value: number | null;
      color: string;
      classifiers?: Record<string, { value: number; status: string }>;
      timeDiffSec?: number;
      classifierSource?: "point" | "cache" | "none";
      trendKind?: "raw" | "bucket";
      bucketStart?: number;
      bucketEnd?: number;
      sampleCount?: number;
    }> = [];

    for (const [metricName, metricData] of this.metrics.entries()) {
      const observations = this.getHoverData(metricData);

      if (observations.length === 0) {
        continue;
      }

      const pointAtCursor = this.getPointAtTime(observations, cursorTime);
      if (pointAtCursor) {
        const pointClassifiers = pointAtCursor.closestObs.classifiers;
        const trendPoint = pointAtCursor.closestObs as Partial<TrendPoint>;
        const cachedClassifiers =
          this.latestClassifiersByMetric.get(metricName);
        const effectiveClassifiers = pointClassifiers ?? cachedClassifiers;
        metricsAtCursor.push({
          name: metricName,
          label: metricData.label, // FD-023
          value: pointAtCursor.value,
          color: metricData.color,
          classifiers: effectiveClassifiers,
          timeDiffSec: pointAtCursor.timeDiffSec,
          classifierSource: pointClassifiers
            ? "point"
            : cachedClassifiers
              ? "cache"
              : "none",
          trendKind: trendPoint.trendKind,
          bucketStart: trendPoint.bucketStart,
          bucketEnd: trendPoint.bucketEnd,
          sampleCount: trendPoint.sampleCount,
        });
      }
    }

    if (metricsAtCursor.length === 0) {
      this.tooltipElement.style.display = "none";
      return;
    }

    // Cache for re-render when hysteresis timer fires while mouse is stationary
    this.lastMetricsAtCursor = metricsAtCursor;
    this.lastCursorTimeSec = cursorTime;

    // Handle active metric hysteresis
    this.updateActiveMetric();

    // Build tooltip HTML
    const tooltipHtml = this.buildTooltipContent(metricsAtCursor, cursorTime);
    this.tooltipElement.innerHTML = tooltipHtml;

    // Position tooltip
    const svgRect = (
      this.core.getSVG().node() as SVGSVGElement
    ).getBoundingClientRect();
    const tooltipX = svgRect.left + this.config.margin.left + x + 40;
    const tooltipY = svgRect.top + this.config.margin.top + y + 15;

    this.tooltipElement.style.left = `${tooltipX}px`;
    this.tooltipElement.style.top = `${tooltipY}px`;
    this.tooltipElement.style.display = "flex";
  }

  private captureLatestClassifiers(
    metricName: string,
    observations: Observation[],
  ): void {
    for (let i = observations.length - 1; i >= 0; i--) {
      const cls = observations[i].classifiers;
      if (cls && Object.keys(cls).length > 0) {
        this.latestClassifiersByMetric.set(metricName, cls);
        return;
      }
    }
  }

  /**
   * Update active metric with hysteresis to avoid rapid switching / flutter.
   *
   * Standard debounce: the timer RESETS on every nearest-metric change.
   * The active metric only commits after the cursor has been continuously
   * closer to the same metric for the full HYSTERESIS_MS window.
   */
  private updateActiveMetric(): void {
    // First hover frame: pick nearest immediately so classifier panel is never empty.
    if (this.activeMetric === null && this.nearestMetric !== null) {
      this.activeMetric = this.nearestMetric;
      return;
    }

    // Cursor still on the same metric — cancel any pending switch timer
    if (this.nearestMetric === this.activeMetric) {
      if (this.activeMetricTimer !== null) {
        clearTimeout(this.activeMetricTimer);
        this.activeMetricTimer = null;
      }
      return;
    }

    // Nearest metric changed — always cancel and restart so the window
    // resets, preventing flutter when cursor oscillates between two lines.
    if (this.activeMetricTimer !== null) {
      clearTimeout(this.activeMetricTimer);
      this.activeMetricTimer = null;
    }

    const targetMetric = this.nearestMetric;
    this.activeMetricTimer = window.setTimeout(() => {
      this.activeMetric = targetMetric;
      this.activeMetricTimer = null;
      // Re-render tooltip in case mouse has stopped (no mousemove incoming)
      if (this.lastMetricsAtCursor.length > 0) {
        this.tooltipElement.innerHTML = this.buildTooltipContent(
          this.lastMetricsAtCursor,
          this.lastCursorTimeSec,
        );
      }
    }, this.HYSTERESIS_MS);
  }

  /**
   * Determine the health status of a metric value relative to its hourly baseline distribution.
   * Returns 'green' | 'yellow' | 'red', or null when no baseline is available.
   *
   * All metrics use symmetric (both-tail) status — no polarity.
   * Any value outside the expected range is flagged, regardless of direction.
   *
   * Classification (aligned with distribution ribbon bands):
   *   green  — value within [p25, p75]  (innermost band)
   *   yellow — value within [p10, p25) or (p75, p90]
   *   red    — value below p10 or above p90
   */
  getMetricStatus(
    metricName: string,
    value: number,
    cursorTimeSec: number,
  ): "green" | "yellow" | "red" | null {
    const metricData = this.metrics.get(metricName);
    if (!metricData || !metricData.baseline) return null;

    // Keep status hour lookup aligned with distribution rendering, which uses local getHours().
    const hour = new Date(cursorTimeSec * 1000).getHours();
    const hourlyDist = metricData.baseline.hourly_distributions.find(
      (d) => d.hour === hour,
    );
    if (!hourlyDist) {
      return null;
    }

    const { p10, p25, p75, p90 } = hourlyDist.distribution;

    if (value >= p25 && value <= p75) return "green";
    if ((value >= p10 && value < p25) || (value > p75 && value <= p90))
      return "yellow";
    return "red";
  }

  /**
   * Format a Unix timestamp (seconds) into tooltip header string.
   * Format: "Mon Jan 1 09:30" (no year, 24h time)
   */
  private formatTooltipTimestamp(cursorTimeSec: number): string {
    const d = new Date(cursorTimeSec * 1000);
    const parts = d.toDateString().split(" "); // e.g. ["Mon", "Jan", "1", "2024"]
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${parts[0]} ${parts[1]} ${parts[2]} ${hh}:${mm}`;
  }

  /** Inline SVG icon helpers for status indicators (16×16, redesign-specified shapes) */
  private static statusIcon(
    status: "green" | "yellow" | "red" | null,
    size: number = 16,
  ): string {
    const s = size;
    const half = s / 2;
    const base = `style="flex-shrink:0;vertical-align:middle"`;
    if (status === "green") {
      // Blue circle with white checkmark
      const ckX1 = (3.5 / 14) * s,
        ckY1 = (7.2 / 14) * s;
      const ckX2 = (5.8 / 14) * s,
        ckY2 = (9.8 / 14) * s;
      const ckX3 = (10.5 / 14) * s,
        ckY3 = (4.5 / 14) * s;
      return `<svg class="status-green" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" fill="none" xmlns="http://www.w3.org/2000/svg" ${base}><circle cx="${half}" cy="${half}" r="${half}" fill="#33BBF5"/><path d="M${ckX1} ${ckY1}L${ckX2} ${ckY2}L${ckX3} ${ckY3}" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (status === "yellow") {
      // Yellow/amber triangle with exclamation
      const triTop = (1 / 14) * s,
        triBot = (12.5 / 14) * s;
      const triLeft = (0.5 / 14) * s,
        triRight = (13.5 / 14) * s;
      const rx = (6.4 / 14) * s,
        ry = (4.5 / 14) * s;
      const rw = (1.2 / 14) * s,
        rh = (4.5 / 14) * s;
      const cx = half,
        cy = (10.5 / 14) * s;
      return `<svg class="status-yellow" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" fill="none" xmlns="http://www.w3.org/2000/svg" ${base}><path d="M${half} ${triTop}L${triRight} ${triBot}H${triLeft}L${half} ${triTop}Z" fill="#F0C243"/><rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${rw / 2}" fill="white"/><circle cx="${cx}" cy="${cy}" r="${(0.7 / 14) * s}" fill="white"/></svg>`;
    }
    if (status === "red") {
      // Red circle with white X
      const x1 = (4.5 / 14) * s,
        y1 = (4.5 / 14) * s;
      const x2 = (9.5 / 14) * s,
        y2 = (9.5 / 14) * s;
      return `<svg class="status-red" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" fill="none" xmlns="http://www.w3.org/2000/svg" ${base}><circle cx="${half}" cy="${half}" r="${half}" fill="#FA5762"/><path d="M${x1} ${y1}L${x2} ${y2}M${x2} ${y1}L${x1} ${y2}" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    }
    // No status data — question-mark placeholder (same width as SVG icons for alignment)
    return `<span style="display:inline-flex;width:${s}px;height:${s}px;align-items:center;justify-content:center;font-size:${Math.round(s * 0.7)}px;opacity:0.55;flex-shrink:0;vertical-align:middle;">?</span>`;
  }

  /** Colored circle matching the metric's trace color — shown to the left of the metric name */
  private static legendDot(color: string): string {
    return `<span style="display:inline-block;width:10px;height:10px;background-color:${color};border:2px solid ${color};border-radius:50%;margin-right:6px;flex-shrink:0;vertical-align:middle;"></span>`;
  }

  /**
   * Render an inline SVG gauge track showing classifier zones and current value.
   * Returns SVG markup with 3 colored zones (red, yellow, green) and a white marker line.
   */
  private buildClassifierGauge(
    classifierName: string,
    value: number,
    cursorTimeSec: number | undefined,
  ): string {
    // Gauge dimensions
    const width = 90;
    const height = 7;
    const radius = 2;

    // Get classifier baseline for the current hour
    const baseline = this.classifierBaselines.get(classifierName);
    if (!baseline) {
      console.warn(`No baseline data for classifier: ${classifierName}`);
      // No baseline data — render a simple gray track with marker at 50%
      const markerX = width / 2;
      return `<svg width="${width}" height="${height}" style="display:block;flex-shrink:0;"><rect width="${width}" height="${height}" rx="${radius}" fill="#444" opacity="0.4"/><line x1="${markerX}" y1="0" x2="${markerX}" y2="${height}" stroke="white" stroke-width="1.5"/></svg>`;
    }

    if (cursorTimeSec === undefined) {
      console.warn(`No cursor time provided for classifier gauge: ${classifierName}`);
      const markerX = width / 2;
      return `<svg width="${width}" height="${height}" style="display:block;flex-shrink:0;"><rect width="${width}" height="${height}" rx="${radius}" fill="#444" opacity="0.4"/><line x1="${markerX}" y1="0" x2="${markerX}" y2="${height}" stroke="white" stroke-width="1.5"/></svg>`;
    }

    const hour = new Date(cursorTimeSec * 1000).getHours();
    const hourlyDist = baseline.hourly_distributions.find((d) => d.hour === hour);
    if (!hourlyDist) {
      console.warn(`No hourly distribution for classifier ${classifierName} at hour ${hour}`);
      // No hourly data — render gray track
      const markerX = width / 2;
      return `<svg width="${width}" height="${height}" style="display:block;flex-shrink:0;"><rect width="${width}" height="${height}" rx="${radius}" fill="#444" opacity="0.4"/><line x1="${markerX}" y1="0" x2="${markerX}" y2="${height}" stroke="white" stroke-width="1.5"/></svg>`;
    }

    const { p5, p10, p25, p95 } = hourlyDist.distribution;
    const range = p95 - p5;

    if (range <= 0) {
      console.warn(`Invalid range for classifier ${classifierName}: p5=${p5}, p95=${p95}`);
      const markerX = width / 2;
      return `<svg width="${width}" height="${height}" style="display:block;flex-shrink:0;"><rect width="${width}" height="${height}" rx="${radius}" fill="#444" opacity="0.4"/><line x1="${markerX}" y1="0" x2="${markerX}" y2="${height}" stroke="white" stroke-width="1.5"/></svg>`;
    }

    // Map value to pixel position (clamp to track bounds)
    const valueNormalized = Math.max(0, Math.min(1, (value - p5) / range));
    const markerX = valueNormalized * width;

    // Calculate zone widths
    const p10X = ((p10 - p5) / range) * width;
    const p25X = ((p25 - p5) / range) * width;

    // Zone 1: p5 to p10 (red/orange-red)
    const zone1Width = p10X;
    // Zone 2: p10 to p25 (yellow)
    const zone2Width = p25X - p10X;
    // Zone 3: p25 to p95 (green, fills remainder)
    const zone3Width = width - p25X;

    let svg = `<svg width="${width}" height="${height}" style="display:block;flex-shrink:0;">`;
    // Render zones left to right
    if (zone1Width > 0) {
      svg += `<rect x="0" y="0" width="${zone1Width}" height="${height}" rx="${radius}" fill="${STATUS_ZONE_COLORS.orangeRed}" opacity="0.7"/>`;
    }
    if (zone2Width > 0) {
      svg += `<rect x="${p10X}" y="0" width="${zone2Width}" height="${height}" fill="${STATUS_ZONE_COLORS.yellow}" opacity="0.7"/>`;
    }
    if (zone3Width > 0) {
      svg += `<rect x="${p25X}" y="0" width="${zone3Width}" height="${height}" rx="${radius}" fill="${STATUS_ZONE_COLORS.green}" opacity="0.7"/>`;
    }
    // Value marker line (white, 1.5px wide)
    svg += `<line x1="${markerX}" y1="0" x2="${markerX}" y2="${height}" stroke="white" stroke-width="1.5"/>`;
    svg += `</svg>`;

    return svg;
  }

  /**
   * Build tooltip HTML content showing all metrics and expanded classifiers for active metric.
   */
  private buildTooltipContent(
    metricsAtCursor: Array<{
      name: string;
      label: string; // FD-023: human-readable display label
      value: number | null;
      color: string;
      classifiers?: Record<string, { value: number; status: string }>;
      trendKind?: "raw" | "bucket";
      bucketStart?: number;
      bucketEnd?: number;
      sampleCount?: number;
    }>,
    cursorTimeSec?: number,
  ): string {
    // No outer wrapper — tooltipElement is the flex column container
    let html = "";

    // Timestamp header at the top of the tooltip — Inter SemiBold 12px
    if (cursorTimeSec !== undefined) {
      const tsLabel = this.formatTooltipTimestamp(cursorTimeSec);
      html += `<div class="tooltip-timestamp" style="font-size:12px;font-weight:600;line-height:18px;color:#F7F7F7;">${tsLabel}</div>`;
    }

    const expandedMetricName = this.resolveExpandedMetricName(metricsAtCursor);

    // Sort metrics in legend order so tooltip rows always match the toggle-button column
    if (this.legendOrder.length > 0) {
      metricsAtCursor.sort((a, b) => {
        const ai = this.legendOrder.indexOf(a.name);
        const bi = this.legendOrder.indexOf(b.name);
        return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
      });
    }

    for (const metric of metricsAtCursor) {
      const isActive = metric.name === expandedMetricName;
      const activeClass = isActive ? " active" : "";

      html += `<div class="tooltip-metric${activeClass}" style="padding:3px 13px;border-radius:4px;">`;
      html += `<div style="display:flex;align-items:center;height:20px;">`;

      // Health-aware status icon based on baseline comparison
      const status =
        metric.value !== null && cursorTimeSec !== undefined
          ? this.getMetricStatus(metric.name, metric.value, cursorTimeSec)
          : null;
      const fallbackClassifierStatus = this.getClassifierAggregateStatus(
        metric.classifiers,
      );

      // Colored legend dot — shown to the left of the metric name
      html += ChartView.legendDot(metric.color);

      // Format value with appropriate units and decimal precision
      const unit = ChartView.METRIC_UNITS[metric.name] ?? "";
      const decimals = ChartView.METRIC_DECIMALS[metric.name] ?? 2;
      const formattedValue =
        metric.value !== null
          ? `${metric.value.toFixed(decimals)}${unit}`
          : "N/A";
      const bucketSeconds =
        metric.bucketStart !== undefined && metric.bucketEnd !== undefined
          ? metric.bucketEnd - metric.bucketStart
          : 0;
      const trendLabel =
        metric.trendKind === "bucket" && metric.sampleCount && bucketSeconds > 0
          ? ` <span style="opacity:0.55;font-size:11px;">${Math.round(bucketSeconds / 60)}m median</span>`
          : "";

      // Layout: [dot] name : value [icon] — icon is right-aligned at end of row
      html += `<span style="flex:1;font-size:14px;line-height:12px;">${metric.label}<span style="opacity:0.6;margin:0 3px;">:</span>${formattedValue}${trendLabel}</span>`;
      html += ChartView.statusIcon(status ?? fallbackClassifierStatus);
      html += `</div>`; // close flex row

      // Expand classifiers only for the active metric
      if (isActive && metric.classifiers) {
        const classifiers = Object.entries(metric.classifiers);

        if (classifiers.length > 0) {
          // Find primary classifier (worst status, or highest weight*deviation)
          const primaryClassifier = this.findPrimaryClassifier(
            metric.classifiers,
          );

          // Indent = legendDot(10px + 2px border) + gap(6px) = ~20px
          // aligns classifier left-edge with first letter of the metric name above
          html +=
            '<div style="margin-left:20px;display:flex;flex-direction:column;gap:3px;padding-right:4px;">';
          for (const [name, data] of classifiers) {
            const isPrimary = name === primaryClassifier;
            const primaryStyle = isPrimary ? "font-weight:600;" : "";

            html += `<div class="tooltip-classifier ${isPrimary ? "primary" : ""}" style="display:flex;justify-content:space-between;align-items:center;gap:8px;${primaryStyle}">`;
            html += `<span style="color:#1D69CC;font-size:10px;font-weight:600;flex-shrink:0;">${name}</span>`;
            // Render gauge track with colored zones and value marker
            html += this.buildClassifierGauge(name, data.value, cursorTimeSec);
            html += `</div>`;
          }
          html += "</div>";
        }
      }

      html += `</div>`; // close .tooltip-metric
    }

    // No outer wrapper close — tooltipElement is the flex container
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
   * Get point value at cursor time using linear interpolation.
   * Also returns nearest source observation for classifier/status metadata.
   */
  private getPointAtTime(
    observations: Observation[],
    cursorTime: number,
  ): { value: number; closestObs: Observation; timeDiffSec: number } | null {
    if (observations.length === 0) return null;
    if (observations.length === 1) {
      const only = observations[0];
      return {
        value: only.value,
        closestObs: only,
        timeDiffSec: Math.abs(only.timestamp - cursorTime),
      };
    }

    const bisect = d3.bisector((o: Observation) => o.timestamp).left;
    const idx = bisect(observations, cursorTime);

    if (idx <= 0) {
      const first = observations[0];
      return {
        value: first.value,
        closestObs: first,
        timeDiffSec: Math.abs(first.timestamp - cursorTime),
      };
    }

    if (idx >= observations.length) {
      const last = observations[observations.length - 1];
      return {
        value: last.value,
        closestObs: last,
        timeDiffSec: Math.abs(last.timestamp - cursorTime),
      };
    }

    const prev = observations[idx - 1];
    const next = observations[idx];
    const prevDiff = Math.abs(prev.timestamp - cursorTime);
    const nextDiff = Math.abs(next.timestamp - cursorTime);
    const closestObs = prevDiff <= nextDiff ? prev : next;

    // Use actual value from closest observation (not interpolated)
    // to ensure metric value and classifier values are from same real observation
    return {
      value: closestObs.value,
      closestObs,
      timeDiffSec: Math.min(prevDiff, nextDiff),
    };
  }

  /**
   * Aggregate classifier statuses to one icon state for tooltip rows.
   */
  private getClassifierAggregateStatus(
    classifiers?: Record<string, { value: number; status: string }>,
  ): "green" | "yellow" | "red" | null {
    if (!classifiers) return null;
    const statuses = Object.values(classifiers).map((c) => c.status);
    if (statuses.length === 0) return null;
    if (statuses.includes("red")) return "red";
    if (statuses.includes("yellow")) return "yellow";
    return "green";
  }

  /**
   * Choose which metric row should be expanded for classifier details.
   * Preference: activeMetric (if it has classifiers) -> nearestMetric (if it has classifiers)
   * -> first metric with classifiers -> activeMetric -> nearestMetric -> none.
   */
  private resolveExpandedMetricName(
    metricsAtCursor: Array<{
      name: string;
      classifiers?: Record<string, { value: number; status: string }>;
    }>,
  ): string | null {
    const hasClassifiers = (name: string | null): boolean => {
      if (!name) return false;
      const row = metricsAtCursor.find((m) => m.name === name);
      return !!row?.classifiers && Object.keys(row.classifiers).length > 0;
    };

    if (hasClassifiers(this.activeMetric)) return this.activeMetric;
    if (hasClassifiers(this.nearestMetric)) return this.nearestMetric;

    const firstWithClassifiers = metricsAtCursor.find(
      (m) => m.classifiers && Object.keys(m.classifiers).length > 0,
    );
    if (firstWithClassifiers) return firstWithClassifiers.name;

    if (
      this.activeMetric &&
      metricsAtCursor.some((m) => m.name === this.activeMetric)
    )
      return this.activeMetric;
    if (
      this.nearestMetric &&
      metricsAtCursor.some((m) => m.name === this.nearestMetric)
    )
      return this.nearestMetric;
    return metricsAtCursor.length > 0 ? metricsAtCursor[0].name : null;
  }

  /**
   * Set the canonical display order for metrics (matches the legend/toggle-button column).
   * Tooltip rows are sorted to this order on every render.
   */
  setLegendOrder(order: string[]): void {
    this.legendOrder = [...order];
  }

  /**
   * Add a metric to the chart.
   * @param metricName - Internal metric key (e.g., "time_to_connect")
   * @param color - Trace color
   * @param label - Optional human-readable display label (FD-023). Falls back to metricName.
   */
  addMetric(metricName: string, color: string, label?: string): void {
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
      label: label ?? metricName, // Use label if provided, else fall back to raw key (FD-023)
      normalizedYDomain: [Infinity, -Infinity], // Will be set to actual data range on first load
      bufferedRange: null,
      displayData: [],
    });

    // Suppress y-axis ticks/labels in overlay mode (0-100 normalized values are meaningless)
    this.core.setYAxisVisible(this.metrics.size <= 1);

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
      const [, remainingData] = Array.from(this.metrics.entries())[0];
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

    // Restore y-axis ticks/labels when back to single metric
    this.core.setYAxisVisible(this.metrics.size <= 1);

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

  _getMetricStateForTest(metricName: string): MetricData | undefined {
    return this.metrics.get(metricName);
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
    this.captureLatestClassifiers(metricName, observations);

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

    // Compute global Y domain across all visible metrics (normalized to 0-100)
    this.updateGlobalYDomain();

    // Ensure line generators have updated scales
    for (const [, metricData] of this.metrics) {
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

    if (this.metrics.size > 1) {
      // Multiple metrics: use normalized 0-100 range
      this.core.updateYDomain([0, 100]);
    } else if (this.metrics.size === 1) {
      // Single metric: use actual values from entire dataset
      const [, metricData] = Array.from(this.metrics.entries())[0];

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
    if (
      observation.classifiers &&
      Object.keys(observation.classifiers).length > 0
    ) {
      this.latestClassifiersByMetric.set(metricName, observation.classifiers);
    }

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
        for (const [, data] of this.metrics) {
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
    for (const [, metricData] of this.metrics) {
      metricData.dataTarget.clear();
      metricData.normalizedYDomain = [Infinity, -Infinity];
      metricData.bufferedRange = null;
      metricData.displayData = [];
      if (metricData.distributionGenerator) {
        metricData.distributionGenerator.hide();
      }
    }

    this.sharedRange.setRange([this.chartStartTime, end]);

    // Update scales and render to ensure chart is not blank
    this.updateGlobalYDomain();
    for (const [, metricData] of this.metrics) {
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
   * Set baseline distribution for a classifier.
   * Stores the 24-hour baseline which will be used to render tooltip gauge zones.
   */
  setClassifierBaseline(classifierName: string, baseline: BaselineResponse): void {
    this.classifierBaselines.set(classifierName, baseline);
    console.log(
      `Set baseline for classifier ${classifierName} with ${baseline.hourly_distributions.length} hourly distributions`,
    );
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
            (currentDist.distribution as unknown as Record<string, number>)[
              key
            ] ?? 0;
          const b =
            (nextDist.distribution as unknown as Record<string, number>)[key] ??
            0;
          interpolated[key] = a + (b - a) * t;
        }
        // Preserve count from current hour
        interpolated["count"] =
          (currentDist.distribution as unknown as Record<string, number>)[
            "count"
          ] ?? 0;

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
    const plotWidth = Math.max(
      1,
      this.config.width - this.config.margin.left - this.config.margin.right,
    );

    // Render each metric
    for (const [, metricData] of this.metrics) {
      // Get ALL buffered data (not just visible range) for pre-rendering
      const allObservations = metricData.dataTarget.getAll();
      const trendDisplay = buildTrendDisplay(
        allObservations,
        range,
        plotWidth,
        metricData.baseline,
      );
      metricData.displayData = trendDisplay.points;

      if (this.metrics.size > 1) {
        // Multiple metrics: normalize to 0-100
        const normalizedObs = trendDisplay.points.map((obs) => ({
          ...obs,
          value: this.normalizeValue(obs.value, metricData.normalizedYDomain),
        }));
        metricData.lineGenerator.update(normalizedObs, range);

        // Hide distribution for multi-metric view
        if (metricData.distributionGenerator) {
          metricData.distributionGenerator.hide();
        }
      } else {
        // Single metric: use actual values for derived display data
        metricData.lineGenerator.update(trendDisplay.points, range);

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
    for (const [, metricData] of this.metrics) {
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

    for (const [, metricData] of this.metrics) {
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
