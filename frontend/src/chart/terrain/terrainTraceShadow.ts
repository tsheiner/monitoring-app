import { Observation } from "../types";
import { gaussianDensity } from "./GaussianDensity";
import { interpolateGaussianParams } from "./baselineAdapter";
import { DistributionDescriptor } from "./types";

export interface TerrainShadowSample {
  timestamp: number;
  value: number;
  strength: number;
}

export interface TerrainShadowStyle {
  blurPx: number;
  spreadPx: number;
  opacityScale: number;
  offsetX: number;
  offsetY: number;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function resolveTerrainShadowStyle(
  crispness: number,
): TerrainShadowStyle {
  const amount = clampUnit(crispness);
  return {
    blurPx: Math.round(12 * (1 - amount) * 100) / 100,
    spreadPx: Math.round(10 * (1 - amount) * 100) / 100,
    opacityScale:
      Math.round((0.08 + 0.92 * amount ** 1.5) * 1000) / 1000,
    offsetX: 3,
    offsetY: 8,
  };
}

function smoothstep(value: number): number {
  const clamped = clampUnit(value);
  return clamped * clamped * (3 - 2 * clamped);
}

export function terrainShadowStrength(
  value: number,
  descriptor: DistributionDescriptor["params"],
  supportDensityRatio: number,
): number {
  const peak = gaussianDensity.pdf(descriptor.mu, descriptor);
  if (!Number.isFinite(peak) || peak <= 0) return 0;
  const densityRatio = gaussianDensity.pdf(value, descriptor) / peak;
  const cutoff = clampUnit(supportDensityRatio);
  if (!Number.isFinite(densityRatio) || densityRatio <= cutoff) return 0;
  return smoothstep((densityRatio - cutoff) / Math.max(1e-9, 1 - cutoff));
}

export function buildTerrainShadowSamples(
  observations: Observation[],
  descriptors: DistributionDescriptor[],
  supportDensityRatio: number,
): TerrainShadowSample[] {
  return observations.map((observation) => {
    const params = interpolateGaussianParams(descriptors, observation.timestamp);
    return {
      timestamp: observation.timestamp,
      value: observation.value,
      strength: params
        ? terrainShadowStrength(
            observation.value,
            params,
            supportDensityRatio,
          )
        : 0,
    };
  });
}
