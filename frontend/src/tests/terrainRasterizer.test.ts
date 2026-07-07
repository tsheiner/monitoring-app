import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_SETTINGS } from "../chart/terrain/defaults";
import {
  computeContourInterval,
  countPeakBands,
  rasterizeTerrain,
} from "../chart/terrain/TerrainRasterizer";
import { DistributionDescriptor } from "../chart/terrain/types";

function descriptors(mu = 0, sigma = 1): DistributionDescriptor[] {
  return [
    { timestamp: 0, params: { mu, sigma } },
    { timestamp: 10, params: { mu, sigma } },
  ];
}

function render(
  sigma = 1,
  settings = DEFAULT_TERRAIN_SETTINGS,
  yDomain: [number, number] = [-4, 4],
) {
  return rasterizeTerrain({
    width: 24,
    height: 41,
    timeRange: [0, 10],
    yDomain,
    descriptors: descriptors(0, sigma),
    referenceSigma: sigma,
    settings,
  });
}

describe("TerrainRasterizer", () => {
  it("is byte deterministic and emits visible and transparent pixels", () => {
    const first = render();
    const second = render();
    expect(first.pixels).toEqual(second.pixels);

    const alphas = Array.from(first.pixels).filter((_, index) => index % 4 === 3);
    expect(Math.max(...alphas)).toBeGreaterThan(0);
    expect(Math.min(...alphas)).toBe(0);
    expect(Array.from(first.pixels).every(Number.isFinite)).toBe(true);
  });

  it("renders a calm stationary ridge with identical interior columns", () => {
    const { pixels, width, height } = render();
    for (let y = 0; y < height; y += 1) {
      const secondColumn = (y * width + 1) * 4;
      const lastColumn = (y * width + width - 1) * 4;
      expect(Array.from(pixels.slice(secondColumn, secondColumn + 4))).toEqual(
        Array.from(pixels.slice(lastColumn, lastColumn + 4)),
      );
    }
  });

  it("gives narrow distributions more peak bands at a fixed interval", () => {
    const interval = computeContourInterval(2, 8);
    expect(countPeakBands(1, interval)).toBeGreaterThan(
      countPeakBands(2, interval),
    );
  });

  it("produces equivalent standardized terrain across metric units", () => {
    const unitScale = render(1, DEFAULT_TERRAIN_SETTINGS, [-4, 4]);
    const scaled = rasterizeTerrain({
      width: 24,
      height: 41,
      timeRange: [0, 10],
      yDomain: [-40, 40],
      descriptors: descriptors(0, 10),
      referenceSigma: 10,
      settings: DEFAULT_TERRAIN_SETTINGS,
    });
    expect(scaled.pixels).toEqual(unitScale.pixels);
  });

  it("makes presence zero fully transparent", () => {
    const { pixels } = render(1, {
      ...DEFAULT_TERRAIN_SETTINGS,
      presence: 0,
    });
    expect(Array.from(pixels).every((value) => value === 0)).toBe(true);
  });

  it("keeps contour interval fixed across a changing distribution", () => {
    const result = rasterizeTerrain({
      width: 30,
      height: 41,
      timeRange: [0, 10],
      yDomain: [-6, 6],
      descriptors: [
        { timestamp: 0, params: { mu: 0, sigma: 1 } },
        { timestamp: 10, params: { mu: 0, sigma: 3 } },
      ],
      referenceSigma: 2,
      settings: DEFAULT_TERRAIN_SETTINGS,
    });
    expect(result.contourInterval).toBe(
      computeContourInterval(
        2,
        3 * 8 ** DEFAULT_TERRAIN_SETTINGS.contourDetail,
      ),
    );
  });
});
