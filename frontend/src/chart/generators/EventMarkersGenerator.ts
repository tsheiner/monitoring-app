/**
 * EventMarkers Generator - Renders vertical event markers on timeline.
 */

import * as d3 from 'd3';
import { Generator, Event } from '../types';

export class EventMarkersGenerator implements Generator {
  private group: d3.Selection<SVGGElement, unknown, null, undefined>;
  private xScale: any;
  private yScale: any;
  private data: Event[] = [];
  private height: number = 0;
  private color: string;
  private hoverColor: string;
  
  constructor(
    parent: d3.Selection<SVGGElement, unknown, null, undefined>,
    color: string = '#999',
    hoverColor: string = '#7EC7FF'
  ) {
    this.color = color;
    this.hoverColor = hoverColor;
    
    this.group = parent
      .append('g')
      .attr('class', 'event-markers');
  }
  
  setScales(xScale: any, yScale: any): void {
    this.xScale = xScale;
    this.yScale = yScale;
    
    // Store chart height from Y scale range
    const range = yScale.range();
    this.height = Math.abs(range[0] - range[1]);
  }
  
  update(data: Event[], range: [number, number]): void {
    this.data = data;
    this.redraw(range);
  }
  
  redraw(range: [number, number]): void {
    if (!this.xScale || !this.yScale) return;
    
    // Filter events to visible range
    const visibleEvents = this.data.filter(
      e => e.timestamp >= range[0] && e.timestamp <= range[1]
    );
    
    // Bind data
    const markers = this.group
      .selectAll<SVGLineElement, Event>('line.event-marker')
      .data(visibleEvents, d => `${d.timestamp}-${d.event_type}`);
    
    // Enter
    const enter = markers.enter()
      .append('line')
      .attr('class', 'event-marker')
      .attr('stroke', this.color)
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.6)
      .style('cursor', 'pointer');
    
    // Enter + Update
    markers.merge(enter)
      .attr('x1', d => this.xScale(new Date(d.timestamp * 1000)))
      .attr('x2', d => this.xScale(new Date(d.timestamp * 1000)))
      .attr('y1', 0)
      .attr('y2', this.height);
    
    // Add hover behavior
    markers.merge(enter)
      .on('mouseenter', (event, d) => {
        d3.select(event.currentTarget)
          .attr('stroke', this.hoverColor)
          .attr('stroke-width', 2)
          .attr('opacity', 1);
        
        // Show tooltip (simplified for prototype)
        this.showTooltip(event, d);
      })
      .on('mouseleave', (event) => {
        d3.select(event.currentTarget)
          .attr('stroke', this.color)
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.6);
        
        this.hideTooltip();
      });
    
    // Exit
    markers.exit().remove();
  }
  
  private showTooltip(event: MouseEvent, data: Event): void {
    // Simple tooltip (could be enhanced)
    const tooltip = d3.select('body')
      .append('div')
      .attr('class', 'event-tooltip')
      .style('position', 'absolute')
      .style('background', '#333')
      .style('color', '#fff')
      .style('padding', '8px')
      .style('border-radius', '4px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('z-index', '1000')
      .html(`
        <strong>${data.event_type}</strong><br/>
        ${data.message}<br/>
        <em>${data.entity || ''}</em>
      `)
      .style('left', `${event.pageX + 10}px`)
      .style('top', `${event.pageY - 10}px`);
  }
  
  private hideTooltip(): void {
    d3.selectAll('.event-tooltip').remove();
  }
  
  show(): void {
    this.group.style('display', null);
  }
  
  hide(): void {
    this.group.style('display', 'none');
  }
  
  resize(width: number, height: number): void {
    this.height = height;
    this.redraw(this.xScale.domain().map((d: Date) => d.getTime() / 1000));
  }
  
  destroy(): void {
    this.group.remove();
  }
}
