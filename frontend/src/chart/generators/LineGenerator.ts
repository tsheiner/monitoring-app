/**
 * Line Generator - Renders line chart for metric observations.
 */

import * as d3 from 'd3';
import { Generator } from './types';
import { Observation } from './types';

export class LineGenerator implements Generator {
  private group: d3.Selection<SVGGElement, unknown, null, undefined>;
  private path: d3.Selection<SVGPathElement, unknown, null, undefined>;
  private xScale: any;
  private yScale: any;
  private data: Observation[] = [];
  private color: string;
  
  constructor(
    parent: d3.Selection<SVGGElement, unknown, null, undefined>,
    color: string = '#4E8DB8'
  ) {
    this.color = color;
    
    this.group = parent
      .append('g')
      .attr('class', 'line-generator');
    
    this.path = this.group
      .append('path')
      .attr('class', 'line')
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1);
  }
  
  setScales(xScale: any, yScale: any): void {
    this.xScale = xScale;
    this.yScale = yScale;
  }
  
  update(data: Observation[], range: [number, number]): void {
    this.data = data;
    this.redraw(range);
  }
  
  redraw(range: [number, number]): void {
    if (!this.xScale || !this.yScale) return;
    
    // Filter data to visible range
    const visibleData = this.data.filter(
      d => d.timestamp >= range[0] && d.timestamp <= range[1]
    );
    
    // Create line generator
    const line = d3.line<Observation>()
      .x(d => this.xScale(new Date(d.timestamp * 1000)))
      .y(d => this.yScale(d.value))
      .curve(d3.curveLinear);
    
    // Update path
    this.path
      .datum(visibleData)
      .attr('d', line);
  }
  
  show(): void {
    this.group.style('display', null);
  }
  
  hide(): void {
    this.group.style('display', 'none');
  }
  
  resize(width: number, height: number): void {
    // Line generator adapts to scale changes automatically
    this.redraw(this.xScale.domain().map((d: Date) => d.getTime() / 1000));
  }
  
  destroy(): void {
    this.group.remove();
  }
}
