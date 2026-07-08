/**
 * Line Generator - Renders line chart for metric observations.
 *
 * Includes LTTB (Largest Triangle Three Buckets) downsampling to maintain
 * visual fidelity while limiting rendered points to ~2x pixel width.
 */

import * as d3 from "d3";
import { Generator } from "../types";
import { Observation } from "../types";
import { TerrainShadowSample } from "../terrain/terrainTraceShadow";

/**
 * LTTB downsampling — reduces a sorted array of observations to `threshold`
 * points while preserving visual shape. Standard algorithm used by Grafana,
 * Datadog, and other time-series dashboards.
 *
 * Reference: Sveinn Steinarsson, "Downsampling Time Series for Visual
 * Representation", 2013.
 */
function lttbDownsample(
  data: Observation[],
  threshold: number,
): Observation[] {
  if (data.length <= threshold || threshold < 3) return data;

  const sampled: Observation[] = [];
  const bucketSize = (data.length - 2) / (threshold - 2);

  // Always keep first point
  sampled.push(data[0]);

  let prevIndex = 0;

  for (let i = 1; i < threshold - 1; i++) {
    // Calculate bucket boundaries
    const bucketStart = Math.floor((i - 1) * bucketSize) + 1;
    const bucketEnd = Math.min(
      Math.floor(i * bucketSize) + 1,
      data.length - 1,
    );

    // Calculate average of next bucket for area computation
    const nextBucketStart = Math.floor(i * bucketSize) + 1;
    const nextBucketEnd = Math.min(
      Math.floor((i + 1) * bucketSize) + 1,
      data.length - 1,
    );

    let avgX = 0;
    let avgY = 0;
    let nextCount = 0;
    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      avgX += data[j].timestamp;
      avgY += data[j].value;
      nextCount++;
    }
    if (nextCount > 0) {
      avgX /= nextCount;
      avgY /= nextCount;
    }

    // Pick point in current bucket with largest triangle area
    const prevX = data[prevIndex].timestamp;
    const prevY = data[prevIndex].value;

    let maxArea = -1;
    let maxIndex = bucketStart;

    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs(
        (prevX - avgX) * (data[j].value - prevY) -
          (prevX - data[j].timestamp) * (avgY - prevY),
      );
      if (area > maxArea) {
        maxArea = area;
        maxIndex = j;
      }
    }

    sampled.push(data[maxIndex]);
    prevIndex = maxIndex;
  }

  // Always keep last point
  sampled.push(data[data.length - 1]);

  return sampled;
}

export class LineGenerator implements Generator {
  private group: d3.Selection<SVGGElement, unknown, null, undefined>;
  private shadowGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private path: d3.Selection<SVGPathElement, unknown, null, undefined>;
  private markersGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
  private xScale: any;
  private yScale: any;
  private data: Observation[] = [];
  private shadowSamples: TerrainShadowSample[] = [];
  private color: string;
  private strokeWidth: number;
  private markerRadius: number;

  /** Maximum points per pixel of chart width for line rendering */
  private static readonly POINTS_PER_PIXEL = 2;
  /** Hide individual markers when more than this many points are visible */
  private static readonly MARKER_DENSITY_THRESHOLD = 200;

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

    this.shadowGroup = this.group
      .append("g")
      .attr("class", "terrain-trace-shadow")
      .style("display", "none");

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

  setTerrainShadow(
    samples: TerrainShadowSample[] | null,
    range: [number, number],
  ): void {
    this.shadowSamples = samples ?? [];
    if (this.shadowSamples.length > 1) {
      this.shadowGroup.style("display", null);
    } else {
      this.shadowGroup.style("display", "none");
    }
    this.redrawShadow(range);
  }

  redraw(range: [number, number]): void {
    if (!this.xScale || !this.yScale) return;

    // Determine chart pixel width from scale range
    const scaleRange = this.xScale.range();
    const chartWidthPx = Math.abs(scaleRange[1] - scaleRange[0]) || 1200;
    const maxPoints = chartWidthPx * LineGenerator.POINTS_PER_PIXEL;

    // LTTB downsample all data for the line path
    const allData = this.data;
    const lineData =
      allData.length > maxPoints
        ? lttbDownsample(allData, maxPoints)
        : allData;

    // Create line generator with smooth interpolation
    const line = d3
      .line<Observation>()
      .x((d) => this.xScale(new Date(d.timestamp * 1000)))
      .y((d) => this.yScale(d.value))
      .curve(d3.curveMonotoneX);

    // Update path with downsampled data
    this.path.datum(lineData).attr("d", line);
    this.redrawShadow(range);

    // Update markers — only show when density is low enough to be useful
    const visibleData = allData.filter(
      (d) => d.timestamp >= range[0] && d.timestamp <= range[1],
    );

    if (visibleData.length > LineGenerator.MARKER_DENSITY_THRESHOLD) {
      // Too dense — hide all markers
      this.markersGroup.selectAll("circle").remove();
    } else {
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
  }

  private redrawShadow(range: [number, number]): void {
    if (!this.xScale || !this.yScale || this.shadowSamples.length < 2) {
      this.shadowGroup.selectAll("path").remove();
      return;
    }

    const runs: TerrainShadowSample[][] = [];
    let currentRun: TerrainShadowSample[] = [];
    for (const sample of this.shadowSamples) {
      if (sample.strength > 0.01) {
        currentRun.push(sample);
      } else {
        if (currentRun.length > 1) runs.push(currentRun);
        currentRun = [];
      }
    }
    if (currentRun.length > 1) runs.push(currentRun);

    const visibleRuns = runs.filter(
      (run) =>
        run[run.length - 1].timestamp >= range[0] &&
        run[0].timestamp <= range[1],
    );
    const shadowLine = d3
      .line<TerrainShadowSample>()
      .x((sample) => this.xScale(new Date(sample.timestamp * 1000)))
      .y((sample) => this.yScale(sample.value))
      .curve(d3.curveMonotoneX);

    const shadowPaths = this.shadowGroup
      .selectAll<SVGPathElement, TerrainShadowSample[]>("path")
      .data(visibleRuns, (run) => run[0].timestamp.toString());

    shadowPaths.exit().remove();
    shadowPaths
      .enter()
      .append("path")
      .attr("fill", "none")
      .attr("stroke", "#08070d")
      .attr("stroke-linecap", "round")
      .attr("stroke-linejoin", "round")
      .style("filter", "blur(3px)")
      .merge(shadowPaths)
      .attr("d", shadowLine)
      .attr("transform", "translate(3 8)")
      .attr("stroke-width", this.strokeWidth + 3)
      .attr("opacity", (run) => {
        const strength =
          run.reduce((total, sample) => total + sample.strength, 0) / run.length;
        return 0.1 + 0.28 * strength;
      });
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
