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

type DistributionPercentileKey =
  | "p1"
  | "p5"
  | "p25"
  | "p50"
  | "p75"
  | "p95"
  | "p99";

interface PercentileAnchor {
  percentile: number;
  key: DistributionPercentileKey;
}

export interface RibbonBandStyle {
  fill: string;
  opacity: number;
  hue: number;
  saturation: number;
  lightness: number;
}

export interface RibbonContourStyle {
  stroke: string;
  opacity: number;
  strokeWidth: number;
}

export const DISTRIBUTION_RIBBON_ANCHORS: PercentileAnchor[] = [
  { percentile: 1, key: "p1" },
  { percentile: 5, key: "p5" },
  { percentile: 25, key: "p25" },
  { percentile: 50, key: "p50" },
  { percentile: 75, key: "p75" },
  { percentile: 95, key: "p95" },
  { percentile: 99, key: "p99" },
];

const RIBBON_BAND_COUNT = 64;
export const DISTRIBUTION_CONTOUR_PERCENTILES = [5, 25, 50, 75, 95] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function percentileForPosition(position: number): number {
  return 1 + clamp(position, 0, 1) * 98;
}

export function getDistributionValueAtPercentile(
  distribution: Distribution,
  percentile: number,
): number {
  const clampedPercentile = clamp(percentile, 1, 99);

  for (let i = 1; i < DISTRIBUTION_RIBBON_ANCHORS.length; i++) {
    const lower = DISTRIBUTION_RIBBON_ANCHORS[i - 1];
    const upper = DISTRIBUTION_RIBBON_ANCHORS[i];
    if (clampedPercentile <= upper.percentile) {
      const span = upper.percentile - lower.percentile;
      const ratio =
        span === 0 ? 0 : (clampedPercentile - lower.percentile) / span;
      const lowerValue = distribution[lower.key];
      const upperValue = distribution[upper.key];
      return lowerValue + (upperValue - lowerValue) * ratio;
    }
  }

  return distribution.p99;
}

export function isValidRibbonDistribution(
  distribution: Distribution,
): boolean {
  let previous = -Infinity;
  for (const anchor of DISTRIBUTION_RIBBON_ANCHORS) {
    const value = distribution[anchor.key];
    if (!Number.isFinite(value) || value < previous) return false;
    previous = value;
  }
  return true;
}

export function getRibbonBandStyle(
  traceColor: string,
  position: number,
): RibbonBandStyle {
  const trace = d3.hsl(traceColor);
  const hue = Number.isFinite(trace.h) ? trace.h : 205;
  const sourceSaturation = Number.isFinite(trace.s) ? trace.s : 0.68;
  const sourceLightness = Number.isFinite(trace.l) ? trace.l : 0.54;

  const clampedPosition = clamp(position, 0, 1);
  const percentile = percentileForPosition(clampedPosition);
  const distanceFromExpectation = Math.abs(percentile - 50);
  const fenceWeight = clamp(1 - distanceFromExpectation / 45, 0, 1);
  const densityWeight = Math.pow(fenceWeight, 1.45);

  const centerSaturation = clamp(sourceSaturation * 0.78, 0.32, 0.68);
  const tailSaturation = clamp(centerSaturation * 0.68, 0.22, 0.46);
  const saturation =
    tailSaturation +
    (centerSaturation - tailSaturation) * densityWeight;

  const centerLightness = clamp(
    sourceLightness + (sourceLightness < 0.5 ? 0.12 : 0.03),
    0.48,
    0.66,
  );
  const tailLightness = clamp(centerLightness + 0.06, 0.54, 0.72);
  const lightness =
    centerLightness + (tailLightness - centerLightness) * (1 - densityWeight);

  const opacity = 0.8 * densityWeight;

  return {
    fill: d3.hsl(hue, saturation, lightness).formatRgb(),
    opacity,
    hue,
    saturation,
    lightness,
  };
}

export function getRibbonContourStyle(
  traceColor: string,
  percentile: number,
): RibbonContourStyle {
  const trace = d3.hsl(traceColor);
  const hue = Number.isFinite(trace.h) ? trace.h : 205;
  const sourceSaturation = Number.isFinite(trace.s) ? trace.s : 0.68;
  const sourceLightness = Number.isFinite(trace.l) ? trace.l : 0.54;
  const saturation = clamp(sourceSaturation * 0.72, 0.34, 0.7);
  const lightness = clamp(
    sourceLightness + (sourceLightness < 0.5 ? 0.18 : 0.08),
    0.56,
    0.76,
  );

  if (percentile === 50) {
    return {
      stroke: d3.hsl(hue, saturation, lightness).formatRgb(),
      opacity: 0.82,
      strokeWidth: 1.45,
    };
  }

  if (percentile === 25 || percentile === 75) {
    return {
      stroke: d3.hsl(hue, saturation * 0.9, lightness).formatRgb(),
      opacity: 0.58,
      strokeWidth: 1,
    };
  }

  return {
    stroke: d3.hsl(hue, saturation * 0.78, lightness).formatRgb(),
    opacity: 0.38,
    strokeWidth: 0.75,
  };
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

    this.group = parent
      .insert("g", ":first-child")
      .attr("class", "distribution-ribbon");
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
    if (!this.xScale || !this.yScale) {
      return;
    }

    this.group.selectAll("*").remove();

    if (this.data.length === 0) {
      return;
    }

    for (let i = 0; i < RIBBON_BAND_COUNT; i++) {
      const lowerPosition = i / RIBBON_BAND_COUNT;
      const upperPosition = (i + 1) / RIBBON_BAND_COUNT;
      const midPosition = (lowerPosition + upperPosition) / 2;
      const lowerPercentile = percentileForPosition(lowerPosition);
      const upperPercentile = percentileForPosition(upperPosition);
      const style = getRibbonBandStyle(this.color, midPosition);

      const area = d3
        .area<DistributionPoint>()
        .defined((d) => isValidRibbonDistribution(d.distribution))
        .x((d) => this.xScale(new Date(d.timestamp * 1000)))
        .y0((d) =>
          this.yScale(
            getDistributionValueAtPercentile(
              d.distribution,
              lowerPercentile,
            ),
          ),
        )
        .y1((d) =>
          this.yScale(
            getDistributionValueAtPercentile(
              d.distribution,
              upperPercentile,
            ),
          ),
        )
        .curve(d3.curveMonotoneX);

      this.group
        .append("path")
        .attr("class", `ribbon-band ribbon-band-${i}`)
        .datum(this.data)
        .attr("d", area)
        .attr("fill", style.fill)
        .attr("opacity", style.opacity)
        .attr("stroke", "none");
    }

    this.renderContours();
  }

  private renderContours(): void {
    for (const percentile of DISTRIBUTION_CONTOUR_PERCENTILES) {
      const style = getRibbonContourStyle(this.color, percentile);
      const line = d3
        .line<DistributionPoint>()
        .defined((d) => isValidRibbonDistribution(d.distribution))
        .x((d) => this.xScale(new Date(d.timestamp * 1000)))
        .y((d) =>
          this.yScale(
            getDistributionValueAtPercentile(d.distribution, percentile),
          ),
        )
        .curve(d3.curveMonotoneX);

      this.group
        .append("path")
        .attr("class", `ribbon-contour ribbon-contour-p${percentile}`)
        .datum(this.data)
        .attr("d", line)
        .attr("fill", "none")
        .attr("stroke", style.stroke)
        .attr("stroke-width", style.strokeWidth)
        .attr("opacity", style.opacity);
    }
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
