/**
 * ChartCore - Core rendering engine with scales and axes.
 * 
 * Manages:
 * - D3 scales (X time, Y linear)
 * - Axes rendering
 * - SVG structure
 */

import * as d3 from 'd3';
import { ChartConfig } from './types';

export class ChartCore {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private chartGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private xScale: d3.ScaleTime<number, number>;
  private yScale: d3.ScaleLinear<number, number>;
  private xAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private yAxis: d3.Selection<SVGGElement, unknown, null, undefined>;
  private config: ChartConfig;
  
  constructor(container: HTMLElement, config: ChartConfig) {
    this.config = config;
    
    // Create SVG
    this.svg = d3.select(container)
      .append('svg')
      .attr('width', config.width)
      .attr('height', config.height);
    
    // Create main chart group with margins
    this.chartGroup = this.svg
      .append('g')
      .attr('class', 'chart-group')
      .attr('transform', `translate(${config.margin.left},${config.margin.top})`);
    
    // Initialize scales
    const chartWidth = config.width - config.margin.left - config.margin.right;
    const chartHeight = config.height - config.margin.top - config.margin.bottom;
    
    this.xScale = d3.scaleTime()
      .domain([new Date(config.timeRange[0] * 1000), new Date(config.timeRange[1] * 1000)])
      .range([0, chartWidth]);
    
    this.yScale = d3.scaleLinear()
      .range([chartHeight, 0]);
    
    // Create axis groups
    this.xAxis = this.chartGroup
      .append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${chartHeight})`);
    
    this.yAxis = this.chartGroup
      .append('g')
      .attr('class', 'y-axis');
    
    // Initial axis render
    this.updateAxes();
  }
  
  /**
   * Update X scale domain (time range).
   */
  updateXDomain(range: [number, number]): void {
    this.xScale.domain([
      new Date(range[0] * 1000),
      new Date(range[1] * 1000)
    ]);
    this.updateAxes();
  }
  
  /**
   * Update Y scale domain.
   */
  updateYDomain(domain: [number, number]): void {
    // Add 10% padding to Y domain
    const padding = (domain[1] - domain[0]) * 0.1;
    this.yScale.domain([
      domain[0] - padding,
      domain[1] + padding
    ]);
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
    const xAxisGenerator = d3.axisBottom(this.xScale)
      .ticks(6)
      .tickFormat(d3.timeFormat('%H:%M'));
    
    this.xAxis
      .call(xAxisGenerator as any)
      .selectAll('line, path')
      .attr('stroke', '#666')
      .attr('stroke-width', 2)
      .attr('shape-rendering', 'crispEdges');
    
    // Y axis
    const yAxisGenerator = d3.axisLeft(this.yScale)
      .ticks(5);
    
    this.yAxis
      .call(yAxisGenerator as any)
      .selectAll('line, path')
      .attr('stroke', '#666')
      .attr('stroke-width', 2)
      .attr('shape-rendering', 'crispEdges');
  }
  
  /**
   * Resize the chart.
   */
  resize(width: number, height: number): void {
    this.config.width = width;
    this.config.height = height;
    
    const chartWidth = width - this.config.margin.left - this.config.margin.right;
    const chartHeight = height - this.config.margin.top - this.config.margin.bottom;
    
    this.svg
      .attr('width', width)
      .attr('height', height);
    
    this.xScale.range([0, chartWidth]);
    this.yScale.range([chartHeight, 0]);
    
    this.xAxis.attr('transform', `translate(0,${chartHeight})`);
    
    this.updateAxes();
  }
  
  /**
   * Destroy and cleanup.
   */
  destroy(): void {
    this.svg.remove();
  }
}
