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
      console.log(`📊 DistributionRibbon.redraw skipped: xScale=${!!this.xScale}, yScale=${!!this.yScale}, data.length=${this.data.length}`);
      return;
    }

    // Debug: Check Y-scale domain and look for outliers
    const yDomain = this.yScale.domain();
    const dataValues = this.data.flatMap(dp => [
      dp.distribution.p1, dp.distribution.p50, dp.distribution.p99
    ]);
    const dataMin = Math.min(...dataValues);
    const dataMax = Math.max(...dataValues);
    
    console.log(`📊 DistributionRibbon rendering ${this.data.length} points, Y-scale: [${yDomain[0].toFixed(2)}, ${yDomain[1].toFixed(2)}], data range: [${dataMin.toFixed(2)}, ${dataMax.toFixed(2)}]`);
    
    // Log first and last distribution points to check for time gaps
    if (this.data.length > 0) {
      const first = this.data[0];
      const last = this.data[this.data.length - 1];
      const xDomain = this.xScale.domain();
      const chartStart = xDomain[0].getTime() / 1000;
      const chartEnd = xDomain[1].getTime() / 1000;
      const gapToChartEnd = chartEnd - last.timestamp;
      
      console.log(`📊 Distribution time range: first=${new Date(first.timestamp*1000).toISOString()}, last=${new Date(last.timestamp*1000).toISOString()}, chart ends at ${new Date(chartEnd*1000).toISOString()}, gap=${gapToChartEnd.toFixed(0)}s`);
      console.log(`📊 Last distribution point: p1=${last.distribution.p1.toFixed(2)}, p50=${last.distribution.p50.toFixed(2)}, p99=${last.distribution.p99.toFixed(2)}`);
    }
    
    if (dataMin < yDomain[0] || dataMax > yDomain[1]) {
      console.warn(`⚠️ Distribution data outside Y-scale: data [${dataMin.toFixed(2)}, ${dataMax.toFixed(2)}], scale [${yDomain[0].toFixed(2)}, ${yDomain[1].toFixed(2)}]`);
      
      // Find the outlier points
      const outliers = this.data.filter(dp => 
        dp.distribution.p1 < yDomain[0] || 
        dp.distribution.p99 > yDomain[1]
      );
      console.warn(`🔍 Outlier distribution points (${outliers.length}):`, 
        outliers.slice(0, 3).map(dp => ({
          ts: new Date(dp.timestamp * 1000).toISOString(),
          p1: dp.distribution.p1.toFixed(2),
          p50: dp.distribution.p50.toFixed(2),
          p99: dp.distribution.p99.toFixed(2)
        }))
      );
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
