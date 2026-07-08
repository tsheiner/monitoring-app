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

export function getRibbonBandStyle(
  traceColor: string,
  position: number,
): RibbonBandStyle {
  const trace = d3.hsl(traceColor);
  const hue = Number.isFinite(trace.h) ? trace.h : 205;
  const sourceSaturation = Number.isFinite(trace.s) ? trace.s : 0.68;
  const sourceLightness = Number.isFinite(trace.l) ? trace.l : 0.54;

  const clampedPosition = clamp(position, 0, 1);
  const distanceFromCenter = Math.abs(clampedPosition - 0.5) / 0.5;
  const centerWeight = 1 - Math.pow(distanceFromCenter, 0.82);

  const centerSaturation = clamp(sourceSaturation * 0.78, 0.32, 0.68);
  const tailSaturation = clamp(centerSaturation * 0.45, 0.16, 0.36);
  const saturation =
    tailSaturation + (centerSaturation - tailSaturation) * centerWeight;

  const centerLightness = clamp(
    sourceLightness + (sourceLightness < 0.5 ? 0.12 : 0.03),
    0.48,
    0.66,
  );
  const tailLightness = clamp(centerLightness + 0.08, 0.54, 0.74);
  const lightness =
    centerLightness + (tailLightness - centerLightness) * (1 - centerWeight);

  const maxOpacity =
    sourceLightness > 0.62 ? 0.24 : sourceLightness < 0.46 ? 0.34 : 0.3;
  const opacity =
    position <= 0 || position >= 1
      ? 0
      : maxOpacity * Math.pow(centerWeight, 0.9);

  return {
    fill: d3.hsl(hue, saturation, lightness).formatRgb(),
    opacity,
    hue,
    saturation,
    lightness,
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
