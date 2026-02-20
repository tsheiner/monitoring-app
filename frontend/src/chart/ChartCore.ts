/**
 * ChartCore - Core rendering engine with scales and axes.
 *
 * Manages:
 * - D3 scales (X time, Y linear)
 * - Axes rendering
 * - SVG structure
 */

import * as d3 from "d3";
import { ChartConfig } from "./types";

export class ChartCore {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private contentGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private xScale: d3.ScaleTime<number, number>;
  private yScale: d3.ScaleLinear<number, number>;
  private xAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private yAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private config: ChartConfig;
  private durationText: d3.Selection<SVGTextElement, unknown, null, undefined>;
  private rangeText: d3.Selection<SVGTextElement, unknown, null, undefined>;
  private zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private onRangeChangeCallback?: (
    range: [number, number],
    userInitiated: boolean,
  ) => void;
  private isHandlingZoom: boolean = false; // Prevent zoom feedback loops
  private panZoomConstraints = {
    minDuration: 300, // 5 minutes in seconds
    maxDuration: 7 * 86400, // 7 days in seconds
    earliestTime: Math.floor(Date.now() / 1000) - 90 * 86400, // 90 days ago
  };

  constructor(container: HTMLElement, config: ChartConfig) {
    this.config = config;

    // Create SVG
    this.svg = d3
      .select(container)
      .append("svg")
      .attr("width", config.width)
      .attr("height", config.height);

    // Create main chart group with margins
    this.chartGroup = this.svg
      .append("g")
      .attr("class", "chart-group")
      .attr(
        "transform",
        `translate(${config.margin.left},${config.margin.top})`,
      );

    // Initialize scales
    const chartWidth = config.width - config.margin.left - config.margin.right;
    const chartHeight =
      config.height - config.margin.top - config.margin.bottom;

    // #region agent log
    fetch("http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "ChartCore.ts:constructor",
        message: "Chart initialized",
        data: {
          width: config.width,
          height: config.height,
          margin: config.margin,
          chartWidth,
          chartHeight,
        },
        timestamp: Date.now(),
        runId: "422-debug",
        hypothesisId: "H2",
      }),
    }).catch(() => {});
    // #endregion

    // Define clip-path to constrain all chart elements within axis boundaries
    this.svg
      .append("defs")
      .append("clipPath")
      .attr("id", "chart-clip")
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", chartWidth)
      .attr("height", chartHeight);

    // Create a content group for clipped elements (lines, distributions, events)
    // This is separate from axes so axes remain visible
    this.contentGroup = this.chartGroup
      .append("g")
      .attr("class", "content-group")
      .attr("clip-path", "url(#chart-clip)");

    this.xScale = d3
      .scaleTime()
      .domain([
        new Date(config.timeRange[0] * 1000),
        new Date(config.timeRange[1] * 1000),
      ])
      .range([0, chartWidth]);

    this.yScale = d3.scaleLinear().range([chartHeight, 0]);

    // Create axis groups
    this.xAxis = this.chartGroup
      .append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${chartHeight})`);

    this.yAxis = this.chartGroup.append("g").attr("class", "y-axis");

    // Create time range info text below X axis
    const textY = chartHeight + 35;
    this.durationText = this.chartGroup
      .append("text")
      .attr("class", "duration-text")
      .attr("x", chartWidth / 2)
      .attr("y", textY)
      .attr("text-anchor", "middle")
      .attr("fill", "#999")
      .attr("font-size", "11px");

    this.rangeText = this.chartGroup
      .append("text")
      .attr("class", "range-text")
      .attr("x", chartWidth / 2)
      .attr("y", textY + 14)
      .attr("text-anchor", "middle")
      .attr("fill", "#888")
      .attr("font-size", "10px");

    // Initialize zoom behavior
    // scaleExtent: 0.1 = zoom out 10x, 10 = zoom in 10x
    // handleZoom will enforce actual time-based constraints (5min-7days)
    this.zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => this.handleZoom(event));

    // Attach zoom to SVG (not chartGroup, to capture all mouse events)
    this.svg.call(this.zoom);

    // Initial axis render
    this.updateAxes();
  }

  /**
   * Update X scale domain (time range).
   */
  updateXDomain(range: [number, number]): void {
    this.xScale.domain([new Date(range[0] * 1000), new Date(range[1] * 1000)]);
    this.updateAxes();
  }

  /**
   * Update Y scale domain.
   */
  updateYDomain(domain: [number, number]): void {
    const previousDomain = this.yScale.domain();
    const domainChanged =
      domain[0] !== previousDomain[0] || domain[1] !== previousDomain[1];

    if (domainChanged) {
      console.log(
        `⚠️ Y-domain CHANGED: [${previousDomain[0].toFixed(2)}, ${previousDomain[1].toFixed(2)}] → [${domain[0].toFixed(2)}, ${domain[1].toFixed(2)}]`,
      );
    }

    // Add 25% padding to both ends for breathing room
    const padding = (domain[1] - domain[0]) * 0.25;
    this.yScale.domain([domain[0] - padding, domain[1] + padding]);
    this.updateAxes();
  }

  /**
   * Get X scale.
   */
  getXScale(): d3.ScaleTime<number, number> {
    return this.xScale;
  }

  /**
   * Get Y scale.
   */
  getYScale(): d3.ScaleLinear<number, number> {
    return this.yScale;
  }

  /**
   * Get chart group for adding generators.
   * Returns the contentGroup which has clipping applied.
   */
  getChartGroup(): d3.Selection<SVGGElement, unknown, null, undefined> {
    return this.contentGroup;
  }

  /**
   * Get unclipped chart group for elements that should extend beyond boundaries.
   * Use this for event markers, tooltips, etc.
   */
  getUnclippedChartGroup(): d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > {
    return this.chartGroup;
  }

  /**
   * Get SVG element for attaching global event handlers.
   */
  getSVG(): d3.Selection<SVGSVGElement, unknown, null, undefined> {
    return this.svg;
  }

  /**
   * Update axes rendering.
   */
  private updateAxes(): void {
    // X axis
    const xAxisGenerator = d3
      .axisBottom(this.xScale)
      .ticks(6)
      .tickFormat(d3.timeFormat("%H:%M"));

    this.xAxis
      .call(xAxisGenerator as any)
      .selectAll("line, path")
      .attr("stroke", "#666")
      .attr("stroke-width", 2)
      .attr("shape-rendering", "crispEdges");

    // Y axis
    const yAxisGenerator = d3.axisLeft(this.yScale).ticks(5);

    this.yAxis
      .call(yAxisGenerator as any)
      .selectAll("line, path")
      .attr("stroke", "#666")
      .attr("stroke-width", 2)
      .attr("shape-rendering", "crispEdges");

    // Update time range info
    this.updateTimeRangeInfo();
  }

  /**
   * Update time range information text.
   */
  private updateTimeRangeInfo(): void {
    const [start, end] = this.xScale.domain();
    const durationSeconds = (end.getTime() - start.getTime()) / 1000;

    // Format duration
    let durationStr: string;
    if (durationSeconds < 3600) {
      const minutes = Math.round(durationSeconds / 60);
      durationStr = `${minutes} minute${minutes !== 1 ? "s" : ""}`;
    } else if (durationSeconds < 86400) {
      const hours = Math.round(durationSeconds / 3600);
      durationStr = `${hours} hour${hours !== 1 ? "s" : ""}`;
    } else {
      const days = Math.round(durationSeconds / 86400);
      durationStr = `${days} day${days !== 1 ? "s" : ""}`;
    }

    // Format range
    const formatDate = d3.timeFormat("%b %d, %Y %H:%M");
    const rangeStr = `${formatDate(start)} – ${formatDate(end)}`;

    this.durationText.text(durationStr);
    this.rangeText.text(rangeStr);
  }

  /**
   * Set callback for range changes from zoom/pan.
   */
  onRangeChange(
    callback: (range: [number, number], userInitiated: boolean) => void,
  ): void {
    this.onRangeChangeCallback = callback;
  }

  /**
   * Set callback for range changes from zoom/pan.
   */
  onRangeChange(
    callback: (range: [number, number], userInitiated: boolean) => void,
  ): void {
    this.onRangeChangeCallback = callback;
  }

  /**
   * Handle zoom/pan events from D3.
   */
  private handleZoom(event: d3.D3ZoomEvent<SVGSVGElement, unknown>): void {
    // Only process user-initiated events (not programmatic updates)
    if (!event.sourceEvent || this.isHandlingZoom) return;

    this.isHandlingZoom = true;

    const transform = event.transform;
    const [domainStart, domainEnd] = this.xScale.domain();
    const currentStart = domainStart.getTime() / 1000;
    const currentEnd = domainEnd.getTime() / 1000;
    const currentDuration = currentEnd - currentStart;

    // Get the chart width
    const chartWidth =
      this.config.width - this.config.margin.left - this.config.margin.right;

    // Calculate new domain based on transform
    // The transform.x represents the pan offset in pixels
    // The transform.k represents the zoom scale factor (1 = no zoom)
    const pixelToTime = currentDuration / chartWidth;
    const panOffsetSeconds = (-transform.x / transform.k) * pixelToTime;

    // Calculate new time range
    let newStart = currentStart + panOffsetSeconds;
    let newEnd = newStart + currentDuration / transform.k;

    // Apply constraints
    const now = Math.floor(Date.now() / 1000);
    const newDuration = newEnd - newStart;

    // Constrain duration
    if (newDuration < this.panZoomConstraints.minDuration) {
      const center = (newStart + newEnd) / 2;
      newStart = center - this.panZoomConstraints.minDuration / 2;
      newEnd = center + this.panZoomConstraints.minDuration / 2;
    } else if (newDuration > this.panZoomConstraints.maxDuration) {
      const center = (newStart + newEnd) / 2;
      newStart = center - this.panZoomConstraints.maxDuration / 2;
      newEnd = center + this.panZoomConstraints.maxDuration / 2;
    }

    // Constrain to time boundaries
    if (newStart < this.panZoomConstraints.earliestTime) {
      const shift = this.panZoomConstraints.earliestTime - newStart;
      newStart += shift;
      newEnd += shift;
    }
    if (newEnd > now) {
      const shift = newEnd - now;
      newStart -= shift;
      newEnd -= shift;
      // Ensure we don't go below earliestTime after shifting
      if (newStart < this.panZoomConstraints.earliestTime) {
        newStart = this.panZoomConstraints.earliestTime;
        newEnd = Math.min(now, newStart + this.panZoomConstraints.maxDuration);
      }
    }

    // Update the X scale domain directly (don't call updateAxes here to avoid recursion)
    this.xScale.domain([new Date(newStart * 1000), new Date(newEnd * 1000)]);

    // Notify ChartView of the range change (user-initiated)
    if (this.onRangeChangeCallback) {
      this.onRangeChangeCallback([newStart, newEnd], true);
    }

    // Reset transform to identity to avoid compounding transforms
    // This must be done AFTER updating the domain and before releasing the flag
    this.svg.call(this.zoom.transform, d3.zoomIdentity);

    this.isHandlingZoom = false;
  }

  /**
   * Programmatically update the time range without triggering zoom callback.
   */
  setTimeRange(range: [number, number]): void {
    this.xScale.domain([new Date(range[0] * 1000), new Date(range[1] * 1000)]);
    this.updateAxes();
  }

  /**
   * Resize the chart.
   */
  resize(width: number, height: number): void {
    this.config.width = width;
    this.config.height = height;

    const chartWidth =
      width - this.config.margin.left - this.config.margin.right;
    const chartHeight =
      height - this.config.margin.top - this.config.margin.bottom;

    this.svg.attr("width", width).attr("height", height);

    this.xScale.range([0, chartWidth]);
    this.yScale.range([chartHeight, 0]);

    this.xAxis.attr("transform", `translate(0,${chartHeight})`);

    // Reposition time range text
    const textY = chartHeight + 35;
    this.durationText.attr("x", chartWidth / 2).attr("y", textY);
    this.rangeText.attr("x", chartWidth / 2).attr("y", textY + 14);

    // Reattach zoom behavior after resize
    this.svg.call(this.zoom);

    this.updateAxes();
  }

  /**
   * Destroy and cleanup.
   */
  destroy(): void {
    this.svg.remove();
  }
}
