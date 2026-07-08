import { Observation } from "../types";
import { gaussianDensity } from "./GaussianDensity";
import { interpolateGaussianParams } from "./baselineAdapter";
import { DistributionDescriptor } from "./types";

export interface TerrainShadowSample {
  timestamp: number;
  value: number;
  strength: number;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
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
