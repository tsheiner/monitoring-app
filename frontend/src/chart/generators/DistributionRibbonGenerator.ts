/**
 * DistributionRibbon Generator - Renders gradient field showing statistical distribution.
 *
 * Visualizes uncertainty/variance over time using percentile bands with gradient opacity.
 */

import * as d3 from "d3";
import { Generator, Distribution, STATUS_ZONE_COLORS } from "../types";

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

    /**
     * Continuous opacity gradient across distribution
     *
     * Strategy: Render multiple fine-grained bands spanning p5-p95.
     * - Color: determined by zone (red: p5-p10, yellow: p10-p25, green: p25-p75, yellow: p75-p90, red: p90-p95)
     * - Opacity: continuous function of distance from p50 (peak at p50, decreasing toward edges)
     *
     * This creates a "density projection" effect where center (normal values) appears
     * denser than edges (outliers), with no opacity reset between color zones.
     */

    // Opacity function: peaks at p50, decreases toward edges
    // Maps position in distribution (0=p5, 0.5=p50, 1=p95) to opacity
    const opacityFunction = (position: number): number => {
      // Position 0.5 = p50 (center)
      const distanceFromCenter = Math.abs(position - 0.5);
      // Parabolic falloff from center
      const maxOpacity = 0.30;
      const minOpacity = 0.08;
      return maxOpacity - (maxOpacity - minOpacity) * (distanceFromCenter / 0.5) ** 0.7;
    };

    // Color function: returns color based on position in distribution
    const colorFunction = (position: number): string => {
      if (position < 0.056) return STATUS_ZONE_COLORS.orangeRed; // p5-p10 (0 to 0.056 = 5% to 10%)
      if (position < 0.222) return STATUS_ZONE_COLORS.yellow;    // p10-p25
      if (position < 0.778) return STATUS_ZONE_COLORS.green;     // p25-p75
      if (position < 0.944) return STATUS_ZONE_COLORS.yellow;    // p75-p90
      return STATUS_ZONE_COLORS.orangeRed;                        // p90-p95
    };

    // Create fine-grained bands to simulate continuous gradient
    const numBands = 20; // More bands = smoother gradient
    for (let i = 0; i < numBands; i++) {
      const lowerPosition = i / numBands;
      const upperPosition = (i + 1) / numBands;
      const midPosition = (lowerPosition + upperPosition) / 2;

      // Interpolate between percentiles
      const getLowerPercentile = (d: DistributionPoint): number => {
        const p5 = d.distribution.p5;
        const p50 = d.distribution.p50;
        const p95 = d.distribution.p95;
        if (lowerPosition < 0.5) {
          return p5 + (p50 - p5) * (lowerPosition / 0.5);
        } else {
          return p50 + (p95 - p50) * ((lowerPosition - 0.5) / 0.5);
        }
      };

      const getUpperPercentile = (d: DistributionPoint): number => {
        const p5 = d.distribution.p5;
        const p50 = d.distribution.p50;
        const p95 = d.distribution.p95;
        if (upperPosition < 0.5) {
          return p5 + (p50 - p5) * (upperPosition / 0.5);
        } else {
          return p50 + (p95 - p50) * ((upperPosition - 0.5) / 0.5);
        }
      };

      const area = d3
        .area<DistributionPoint>()
        .x((d) => this.xScale(new Date(d.timestamp * 1000)))
        .y0((d) => this.yScale(getLowerPercentile(d)))
        .y1((d) => this.yScale(getUpperPercentile(d)))
        .curve(d3.curveMonotoneX);

      this.group
        .append("path")
        .attr("class", `ribbon-band-${i}`)
        .datum(this.data)
        .attr("d", area)
        .attr("fill", colorFunction(midPosition))
        .attr("opacity", opacityFunction(midPosition))
        .attr("stroke", "none");
    }

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
