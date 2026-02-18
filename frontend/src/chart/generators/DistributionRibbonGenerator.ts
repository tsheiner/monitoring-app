/**
 * DistributionRibbon Generator - Renders gradient field showing statistical distribution.
 *
 * Visualizes uncertainty/variance over time using percentile bands with gradient opacity.
 */

import * as d3 from "d3";
import { Generator, Distribution } from "../types";

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
    color: string = "#4E8DB8",
  ) {
    this.color = color;

    this.group = parent.append("g").attr("class", "distribution-ribbon");
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
    if (!this.xScale || !this.yScale || this.data.length === 0) {
      return;
    }

    // Clear existing paths
    this.group.selectAll("*").remove();

    // Create 5-band gradient with decreasing opacity from center outward
    // p1-p99 (outermost, lightest), p5-p95, p10-p90, p25-p75 (innermost, darkest)
    // Plus p50 expectation line

    const bands = [
      { lower: "p1", upper: "p99", opacity: 0.08, name: "band-1-99" },
      { lower: "p5", upper: "p95", opacity: 0.12, name: "band-5-95" },
      { lower: "p10", upper: "p90", opacity: 0.18, name: "band-10-90" },
      { lower: "p25", upper: "p75", opacity: 0.25, name: "band-25-75" },
    ];

    // Render bands from widest to narrowest (back to front)
    bands.forEach((band) => {
      const area = d3
        .area<DistributionPoint>()
        .x((d) => this.xScale(new Date(d.timestamp * 1000)))
        .y0((d) =>
          this.yScale(
            d.distribution[band.lower as keyof Distribution] as number,
          ),
        )
        .y1((d) =>
          this.yScale(
            d.distribution[band.upper as keyof Distribution] as number,
          ),
        )
        .curve(d3.curveMonotoneX);

      this.group
        .append("path")
        .attr("class", `ribbon-${band.name}`)
        .datum(this.data)
        .attr("d", area)
        .attr("fill", this.color)
        .attr("opacity", band.opacity)
        .attr("stroke", "none");
    });

    // Render p50 expectation line on top
    const expectationLine = d3
      .line<DistributionPoint>()
      .x((d) => this.xScale(new Date(d.timestamp * 1000)))
      .y((d) => this.yScale(d.distribution.p50))
      .curve(d3.curveMonotoneX);

    this.group
      .append("path")
      .attr("class", "expectation-line")
      .datum(this.data)
      .attr("d", expectationLine)
      .attr("fill", "none")
      .attr("stroke", "#2a2a2a")
      .attr("stroke-width", 1.5)
      .attr("opacity", 1);
  }

  show(): void {
    this.group.style("display", null);
  }

  hide(): void {
    this.group.style("display", "none");
  }

  resize(width: number, height: number): void {
    this.redraw(this.xScale.domain().map((d: Date) => d.getTime() / 1000));
  }

  destroy(): void {
    this.group.remove();
  }
}
