/**
 * Line Generator - Renders line chart for metric observations.
 */

import * as d3 from "d3";
import { Generator } from "./types";
import { Observation } from "./types";

export class LineGenerator implements Generator {
  private group: d3.Selection<SVGGElement, unknown, null, undefined>;
  private path: d3.Selection<SVGPathElement, unknown, null, undefined>;
  private markersGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private xScale: any;
  private yScale: any;
  private data: Observation[] = [];
  private color: string;
  private strokeWidth: number;
  private markerRadius: number;

  constructor(
    parent: d3.Selection<SVGGElement, unknown, null, undefined>,
    color: string = "#4E8DB8",
    strokeWidth: number = 2,
    markerRadius: number = 5,
  ) {
    this.color = color;
    this.strokeWidth = strokeWidth;
    this.markerRadius = markerRadius;

    this.group = parent.append("g").attr("class", "line-generator");

    this.path = this.group
      .append("path")
      .attr("class", "line")
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", strokeWidth);

    this.markersGroup = this.group.append("g").attr("class", "markers");
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

    // Draw ALL data from buffer, let clip-path handle visibility
    // This provides instant pan - data is already rendered, just masked
    const allData = this.data;

    // Create line generator with smooth interpolation
    const line = d3
      .line<Observation>()
      .x((d) => this.xScale(new Date(d.timestamp * 1000)))
      .y((d) => this.yScale(d.value))
      .curve(d3.curveMonotoneX);

    // Update path with ALL data
    this.path.datum(allData).attr("d", line);

    // Update markers (circle at each data point)
    // Note: markers only show for visible range to avoid rendering 1000+ circles
    const visibleData = allData.filter(
      (d) => d.timestamp >= range[0] && d.timestamp <= range[1],
    );
    
    const markers = this.markersGroup
      .selectAll<SVGCircleElement, Observation>("circle")
      .data(visibleData, (d) => d.timestamp.toString());

    markers.exit().remove();

    markers
      .enter()
      .append("circle")
      .attr("r", this.markerRadius)
      .attr("fill", this.color)
      .merge(markers)
      .attr("cx", (d) => this.xScale(new Date(d.timestamp * 1000)))
      .attr("cy", (d) => this.yScale(d.value));
  }

  show(): void {
    this.group.style("display", null);
  }

  hide(): void {
    this.group.style("display", "none");
  }

  resize(width: number, height: number): void {
    // Line generator adapts to scale changes automatically
    this.redraw(this.xScale.domain().map((d: Date) => d.getTime() / 1000));
  }

  destroy(): void {
    this.group.remove();
  }
}
