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

    // Filter data to visible range
    const visibleData = this.data.filter(
      (d) => d.timestamp >= range[0] && d.timestamp <= range[1],
    );

    // #region agent log
    if (visibleData.length > 0) {
      const xPixels = visibleData.map(d => this.xScale(new Date(d.timestamp * 1000)));
      const yPixels = visibleData.map(d => this.yScale(d.value));
      const xRange = this.xScale.range();
      const yRange = this.yScale.range();
      const outOfBoundsX = xPixels.filter(x => x < xRange[0] || x > xRange[1]);
      const outOfBoundsY = yPixels.filter(y => y < yRange[1] || y > yRange[0]);
      const hasClipPath = !!this.path.attr('clip-path');
      fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LineGenerator.ts:redraw',message:'Drawing line with coordinates',data:{visibleCount:visibleData.length,xRange,yRange,xPixelRange:[Math.min(...xPixels),Math.max(...xPixels)],yPixelRange:[Math.min(...yPixels),Math.max(...yPixels)],outOfBoundsXCount:outOfBoundsX.length,outOfBoundsYCount:outOfBoundsY.length,sampleOutOfBoundsX:outOfBoundsX.slice(0,3),sampleOutOfBoundsY:outOfBoundsY.slice(0,3),hasClipPath},timestamp:Date.now(),runId:'zoom-overflow-debug',hypothesisId:'H4'})}).catch(()=>{});
    }
    // #endregion

    // Create line generator with smooth interpolation
    const line = d3
      .line<Observation>()
      .x((d) => this.xScale(new Date(d.timestamp * 1000)))
      .y((d) => this.yScale(d.value))
      .curve(d3.curveMonotoneX);

    // Update path
    this.path.datum(visibleData).attr("d", line);

    // Update markers (circle at each data point)
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
