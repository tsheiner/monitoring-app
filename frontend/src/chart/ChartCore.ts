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
  private xScale: d3.ScaleTime<number, number>;
  private yScale: d3.ScaleLinear<number, number>;
  private xAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private yAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private config: ChartConfig;
  private durationText: d3.Selection<SVGTextElement, unknown, null, undefined>;
  private rangeText: d3.Selection<SVGTextElement, unknown, null, undefined>;

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
    // Add 10% padding to both ends
    const padding = (domain[1] - domain[0]) * 0.1;
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
   */
  getChartGroup(): d3.Selection<SVGGElement, unknown, null, undefined> {
    return this.chartGroup;
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

    this.updateAxes();
  }

  /**
   * Destroy and cleanup.
   */
  destroy(): void {
    this.svg.remove();
  }
}
