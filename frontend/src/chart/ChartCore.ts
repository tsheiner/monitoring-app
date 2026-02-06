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
  private brushGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private brushXScale: d3.ScaleTime<number, number>;
  private brushAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private brush: d3.BrushBehavior<unknown>;
  private fullTimeRange: [number, number]; // Store the full data range
  private onBrushCallback?: (range: [number, number]) => void;
  private updatingBrush: boolean = false; // Flag to prevent event loops

  constructor(container: HTMLElement, config: ChartConfig) {
    this.config = config;
    this.fullTimeRange = [...config.timeRange]; // Store initial range

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

    // Create brush control for range selection
    const brushHeight = 40;
    const brushY = chartHeight + 60;

    this.brushGroup = this.chartGroup
      .append("g")
      .attr("class", "brush-context")
      .attr("transform", `translate(0,${brushY})`);

    // Brush X scale (same domain as main chart)
    this.brushXScale = d3
      .scaleTime()
      .domain([
        new Date(config.timeRange[0] * 1000),
        new Date(config.timeRange[1] * 1000),
      ])
      .range([0, chartWidth]);

    // Draw background rect for brush area
    this.brushGroup
      .append("rect")
      .attr("class", "brush-background")
      .attr("width", chartWidth)
      .attr("height", brushHeight)
      .attr("fill", "#1a1a1a")
      .attr("stroke", "#444")
      .attr("stroke-width", 1);

    // Create brush axis showing full timeline
    this.brushAxis = this.brushGroup
      .append("g")
      .attr("class", "brush-axis")
      .attr("transform", `translate(0,${brushHeight})`);

    const brushAxisGenerator = d3
      .axisBottom(this.brushXScale)
      .ticks(8)
      .tickFormat(d3.timeFormat("%b %d %H:%M"));

    this.brushAxis
      .call(brushAxisGenerator as any)
      .selectAll("line, path")
      .attr("stroke", "#555")
      .attr("stroke-width", 1);

    this.brushAxis
      .selectAll("text")
      .attr("fill", "#888")
      .attr("font-size", "9px");

    // Create brush
    this.brush = d3
      .brushX()
      .extent([
        [0, 0],
        [chartWidth, brushHeight],
      ])
      .on("brush end", (event) => this.handleBrush(event));

    // Add brush to group
    const brushSelection = this.brushGroup.append("g").attr("class", "brush");
    brushSelection.call(this.brush);

    // Initialize brush with current view range
    const x0 = this.brushXScale(new Date(config.timeRange[0] * 1000));
    const x1 = this.brushXScale(new Date(config.timeRange[1] * 1000));
    brushSelection.call(this.brush.move as any, [x0, x1]);

    // Style brush handles and selection
    brushSelection
      .selectAll(".handle")
      .attr("fill", "#666")
      .attr("stroke", "#999")
      .attr("stroke-width", 1);

    brushSelection
      .selectAll(".selection")
      .attr("fill", "#4a9eff")
      .attr("fill-opacity", 0.3)
      .attr("stroke", "#4a9eff")
      .attr("stroke-width", 2);

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
   * Set callback for brush range changes.
   */
  onBrushChange(callback: (range: [number, number]) => void): void {
    this.onBrushCallback = callback;
  }

  /**
   * Handle brush selection.
   * Supports both sliding (move) and resizing (change duration).
   */
  private handleBrush(event: any): void {
    // Ignore if we're programmatically updating the brush
    if (this.updatingBrush) return;

    // Only act on user-initiated events (not programmatic)
    if (!event.sourceEvent || !event.selection || !this.onBrushCallback) return;

    const [x0, x1] = event.selection;
    const start = Math.floor(this.brushXScale.invert(x0).getTime() / 1000);
    const end = Math.floor(this.brushXScale.invert(x1).getTime() / 1000);

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartCore.ts:handleBrush',message:'User brush interaction',data:{eventType:event.type,sourceEventType:event.sourceEvent?.type,x0,x1,start,end,duration:end-start,fullRangeStart:this.fullTimeRange[0],fullRangeEnd:this.fullTimeRange[1],updatingBrushFlag:this.updatingBrush},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

    // Only trigger if range is meaningful (> 1 minute)
    if (end - start > 60) {
      console.log(
        `Brush moved by user: ${new Date(start * 1000).toISOString()} to ${new Date(end * 1000).toISOString()}`,
      );
      this.onBrushCallback([start, end]);
    }
  }

  /**
   * Update full time range (for brush context).
   */
  updateFullTimeRange(range: [number, number]): void {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartCore.ts:updateFullTimeRange',message:'Updating brush context full range',data:{oldFullRange:[this.fullTimeRange[0],this.fullTimeRange[1]],newFullRange:[range[0],range[1]],delta:{start:range[0]-this.fullTimeRange[0],end:range[1]-this.fullTimeRange[1]}},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion

    this.fullTimeRange = [...range];
    this.brushXScale.domain([
      new Date(range[0] * 1000),
      new Date(range[1] * 1000),
    ]);
    // Update brush axis
    const brushAxisGenerator = d3
      .axisBottom(this.brushXScale)
      .ticks(8)
      .tickFormat(d3.timeFormat("%b %d %H:%M"));

    this.brushAxis.call(brushAxisGenerator as any);
  }

  /**
   * Update brush selection to match current view (without triggering callback).
   */
  updateBrushSelection(range: [number, number]): void {
    const x0 = this.brushXScale(new Date(range[0] * 1000));
    const x1 = this.brushXScale(new Date(range[1] * 1000));

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartCore.ts:updateBrushSelection',message:'Programmatically updating brush',data:{rangeStart:range[0],rangeEnd:range[1],x0,x1,brushScaleDomain:[this.brushXScale.domain()[0].getTime()/1000,this.brushXScale.domain()[1].getTime()/1000],updatingBrushFlagBefore:this.updatingBrush},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion

    // Set flag to prevent feedback loop
    this.updatingBrush = true;

    // Move brush without triggering callback
    this.brushGroup.select(".brush").call(this.brush.move as any, [x0, x1]);

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartCore.ts:updateBrushSelection:after',message:'Brush moved programmatically, setting timeout',data:{timeoutMs:50,updatingBrushFlag:this.updatingBrush},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion

    // Clear flag after a short delay to ensure all events have settled
    setTimeout(() => {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ChartCore.ts:updateBrushSelection:timeout',message:'Timeout fired, clearing updatingBrush flag',data:{updatingBrushFlagBefore:this.updatingBrush},timestamp:Date.now(),sessionId:'debug-session',runId:'brush-test',hypothesisId:'H3'})}).catch(()=>{});
      // #endregion
      this.updatingBrush = false;
    }, 50);
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

    // Reposition and resize brush
    const brushY = chartHeight + 60;
    const brushHeight = 40;
    this.brushGroup.attr("transform", `translate(0,${brushY})`);
    this.brushXScale.range([0, chartWidth]);
    this.brush.extent([
      [0, 0],
      [chartWidth, brushHeight],
    ]);

    this.brushGroup
      .select(".brush-background")
      .attr("width", chartWidth)
      .attr("height", brushHeight);

    // Update brush axis position
    this.brushAxis.attr("transform", `translate(0,${brushHeight})`);

    // Update brush axis with new scale
    const brushAxisGenerator = d3
      .axisBottom(this.brushXScale)
      .ticks(8)
      .tickFormat(d3.timeFormat("%b %d %H:%M"));
    this.brushAxis.call(brushAxisGenerator as any);

    // Reapply brush with new extent
    this.brushGroup.select(".brush").call(this.brush);

    this.updateAxes();
  }

  /**
   * Destroy and cleanup.
   */
  destroy(): void {
    this.svg.remove();
  }
}
