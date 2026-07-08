import { describe, expect, it } from "vitest";
import {
  baselineToGaussianDescriptors,
  distributionToGaussianParams,
  interpolateGaussianParams,
  medianReferenceSigma,
} from "../chart/terrain/baselineAdapter";
import { gaussianDensity } from "../chart/terrain/GaussianDensity";
import {
  DEFAULT_TERRAIN_SETTINGS,
  normalizeTerrainSettings,
  resolveTerrainConfig,
} from "../chart/terrain/defaults";
import { BaselineResponse, Distribution } from "../chart/types";

function distribution(mean: number, stddev: number): Distribution {
  return {
    p1: mean - 2.33 * stddev,
    p5: mean - 1.645 * stddev,
    p10: mean - 1.28 * stddev,
    p25: mean - 0.6745 * stddev,
    p50: mean,
    p75: mean + 0.6745 * stddev,
    p90: mean + 1.28 * stddev,
    p95: mean + 1.645 * stddev,
    p99: mean + 2.33 * stddev,
    mean,
    stddev,
  };
}

describe("Gaussian terrain data", () => {
  it("is symmetric, peaks at mu, and broadens as sigma grows", () => {
    const narrowPeak = gaussianDensity.pdf(10, { mu: 10, sigma: 1 });
    const broadPeak = gaussianDensity.pdf(10, { mu: 10, sigma: 2 });
    expect(gaussianDensity.pdf(8, { mu: 10, sigma: 2 })).toBeCloseTo(
      gaussianDensity.pdf(12, { mu: 10, sigma: 2 }),
      12,
    );
    expect(narrowPeak).toBeGreaterThan(broadPeak);
    expect(narrowPeak).toBeGreaterThan(
      gaussianDensity.pdf(11, { mu: 10, sigma: 1 }),
    );
  });

  it("matches a numerical value derivative", () => {
    const params = { mu: 4, sigma: 1.5 };
    const value = 5;
    const epsilon = 1e-5;
    const numeric =
      (gaussianDensity.pdf(value + epsilon, params) -
        gaussianDensity.pdf(value - epsilon, params)) /
      (2 * epsilon);
    expect(gaussianDensity.dpdfDy?.(value, params)).toBeCloseTo(numeric, 7);
  });

  it("uses stddev, IQR, then Y-span fallback for sigma", () => {
    expect(distributionToGaussianParams(distribution(10, 2), 100).sigma).toBe(2);

    const iqrOnly = { ...distribution(10, 2), stddev: 0 };
    expect(distributionToGaussianParams(iqrOnly, 100).sigma).toBeCloseTo(2, 3);

    const spanFallback = {
      ...iqrOnly,
      p25: 10,
      p75: 10,
    };
    expect(distributionToGaussianParams(spanFallback, 200).sigma).toBe(2);
  });

  it("interpolates parameters and finds the median reference sigma", () => {
    const descriptors = [
      { timestamp: 0, params: { mu: 10, sigma: 1 } },
      { timestamp: 10, params: { mu: 20, sigma: 3 } },
      { timestamp: 20, params: { mu: 30, sigma: 5 } },
    ];
    expect(interpolateGaussianParams(descriptors, 5)).toEqual({
      mu: 15,
      sigma: 2,
    });
    expect(medianReferenceSigma(descriptors)).toBe(3);
  });

  it("interpolates hourly baselines across midnight", () => {
    const baseline: BaselineResponse = {
      metric: "test",
      entity: null,
      lookback_days: 30,
      timezone: "local",
      hourly_distributions: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        distribution: distribution(hour, 1 + hour / 24),
        fallback_source: "data",
        sample_count: 30,
      })),
    };
    const start = new Date(2025, 0, 1, 23, 30).getTime() / 1000;
    const descriptors = baselineToGaussianDescriptors(
      baseline,
      [start, start + 3600],
      100,
    );
    expect(descriptors.length).toBeGreaterThan(20);
    expect(descriptors[0].params.mu).toBeCloseTo(11.5, 5);
    expect(descriptors[descriptors.length - 1].params.mu).toBeCloseTo(0.5, 5);
  });
});

describe("Terrain setting mapping", () => {
  it("clamps all slider values", () => {
    expect(
      normalizeTerrainSettings({
        ridgeDefinition: -1,
        timeVsShapeBias: 2,
        contourDetail: Number.NaN,
        relief: 0.25,
        presence: 0.75,
        colorContrast: 1.5,
        distributionExtent: -0.5,
        shadowCrispness: 1.5,
      }),
    ).toEqual({
      ridgeDefinition: 0,
      timeVsShapeBias: 1,
      contourDetail: 0,
      relief: 0.25,
      presence: 0.75,
      colorContrast: 1,
      distributionExtent: 0,
      shadowCrispness: 1,
    });
  });

  it("supplies deterministic defaults for settings added after initial release", () => {
    const normalized = normalizeTerrainSettings({
      ridgeDefinition: 0.2,
      timeVsShapeBias: 0.3,
      contourDetail: 0.4,
      relief: 0.5,
      presence: 0.6,
    });
    expect(normalized.colorContrast).toBe(
      DEFAULT_TERRAIN_SETTINGS.colorContrast,
    );
    expect(normalized.distributionExtent).toBe(
      DEFAULT_TERRAIN_SETTINGS.distributionExtent,
    );
    expect(normalized.shadowCrispness).toBe(
      DEFAULT_TERRAIN_SETTINGS.shadowCrispness,
    );
  });

  it("maps defaults deterministically and presence zero to zero opacity", () => {
    expect(resolveTerrainConfig(DEFAULT_TERRAIN_SETTINGS)).toEqual(
      resolveTerrainConfig({ ...DEFAULT_TERRAIN_SETTINGS }),
    );
    expect(
      resolveTerrainConfig({ ...DEFAULT_TERRAIN_SETTINGS, presence: 0 })
        .layerOpacity,
    ).toBe(0);
  });

  it("maps presence, color contrast, and extent independently", () => {
    const base = resolveTerrainConfig(DEFAULT_TERRAIN_SETTINGS);
    const presence = resolveTerrainConfig({
      ...DEFAULT_TERRAIN_SETTINGS,
      presence: 0.9,
    });
    const color = resolveTerrainConfig({
      ...DEFAULT_TERRAIN_SETTINGS,
      colorContrast: 0.9,
    });
    const extent = resolveTerrainConfig({
      ...DEFAULT_TERRAIN_SETTINGS,
      distributionExtent: 0.9,
    });

    expect(presence.layerOpacity).not.toBe(base.layerOpacity);
    expect(presence.paletteStrength).toBe(base.paletteStrength);
    expect(presence.supportDensityRatio).toBe(base.supportDensityRatio);
    expect(color.layerOpacity).toBe(base.layerOpacity);
    expect(color.paletteStrength).not.toBe(base.paletteStrength);
    expect(color.supportDensityRatio).toBe(base.supportDensityRatio);
    expect(extent.layerOpacity).toBe(base.layerOpacity);
    expect(extent.paletteStrength).toBe(base.paletteStrength);
    expect(extent.supportDensityRatio).not.toBe(base.supportDensityRatio);
  });

  it("uses a non-traffic-light ordered palette", () => {
    const { palette } = resolveTerrainConfig(DEFAULT_TERRAIN_SETTINGS);
    expect(palette).toHaveProperty("low");
    expect(palette).toHaveProperty("middle");
    expect(palette).toHaveProperty("ridge");
    expect(palette).not.toEqual(
      expect.objectContaining({
        low: expect.arrayContaining([255, 0, 0]),
      }),
    );
  });
});
