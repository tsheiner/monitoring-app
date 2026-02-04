/**
 * DistributionRibbon Generator - Renders gradient field showing statistical distribution.
 * 
 * Visualizes uncertainty/variance over time using percentile bands with gradient opacity.
 */

import * as d3 from 'd3';
import { Generator, Distribution } from '../types';

interface DistributionPoint {
  timestamp: number;
  distribution: Distribution;
}

export class DistributionRibbonGenerator implements Generator {
  private group: d3.Selection<SVGGElement, unknown, null, undefined>;
  private xScale: any;
  private yScale: any;
  private data: DistributionPoint[] = [];
  private color: string;
  
  constructor(
    parent: d3.Selection<SVGGElement, unknown, null, undefined>,
    color: string = '#4E8DB8'
  ) {
    this.color = color;
    
    this.group = parent
      .append('g')
      .attr('class', 'distribution-ribbon');
  }
  
  setScales(xScale: any, yScale: any): void {
    this.xScale = xScale;
    this.yScale = yScale;
  }
  
  update(data: DistributionPoint[], range: [number, number]): void {
    this.data = data;
    this.redraw(range);
  }
  
  redraw(range: [number, number]): void {
    if (!this.xScale || !this.yScale || this.data.length === 0) return;
    
    // Clear existing paths
    this.group.selectAll('path').remove();
    
    // Create area generators for each percentile band
    // Bands: p5-p25, p25-p75, p75-p95
    // Opacity: Darker in center (p25-p75), lighter at edges
    
    const bands = [
      { lower: 'p5', upper: 'p95', opacity: 0.1, name: 'outer' },
      { lower: 'p25', upper: 'p75', opacity: 0.25, name: 'inner' }
    ];
    
    bands.forEach(band => {
      const area = d3.area<DistributionPoint>()
        .x(d => this.xScale(new Date(d.timestamp * 1000)))
        .y0(d => this.yScale(d.distribution[band.lower as keyof Distribution] as number))
        .y1(d => this.yScale(d.distribution[band.upper as keyof Distribution] as number))
        .curve(d3.curveLinear);
      
      this.group
        .append('path')
        .attr('class', `ribbon-${band.name}`)
        .datum(this.data)
        .attr('d', area)
        .attr('fill', this.color)
        .attr('opacity', band.opacity)
        .attr('stroke', 'none');
    });
  }
  
  show(): void {
    this.group.style('display', null);
  }
  
  hide(): void {
    this.group.style('display', 'none');
  }
  
  resize(width: number, height: number): void {
    this.redraw(this.xScale.domain().map((d: Date) => d.getTime() / 1000));
  }
  
  destroy(): void {
    this.group.remove();
  }
}
