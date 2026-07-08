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

function visiblePixelCount(pixels: Uint8ClampedArray): number {
  let count = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) count += 1;
  }
  return count;
}

function pixelAt(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const offset = (y * width + x) * 4;
  return [
    pixels[offset],
    pixels[offset + 1],
    pixels[offset + 2],
    pixels[offset + 3],
  ];
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

  it("makes pixels beyond the practical support envelope transparent", () => {
    const { pixels, width, height } = render();
    const topAlpha = pixels[3];
    const bottomAlpha = pixels[((height - 1) * width) * 4 + 3];
    const ridgeAlpha = pixels[(Math.floor(height / 2) * width) * 4 + 3];
    expect(topAlpha).toBe(0);
    expect(bottomAlpha).toBe(0);
    expect(ridgeAlpha).toBeGreaterThan(0);
  });

  it("expands support monotonically without changing the ridge", () => {
    const compact = render(1, {
      ...DEFAULT_TERRAIN_SETTINGS,
      distributionExtent: 0.15,
    });
    const extended = render(1, {
      ...DEFAULT_TERRAIN_SETTINGS,
      distributionExtent: 0.95,
    });
    expect(visiblePixelCount(extended.pixels)).toBeGreaterThan(
      visiblePixelCount(compact.pixels),
    );

    const ridgeOffset = (Math.floor(compact.height / 2) * compact.width) * 4;
    expect(
      Array.from(compact.pixels.slice(ridgeOffset, ridgeOffset + 3)),
    ).toEqual(Array.from(extended.pixels.slice(ridgeOffset, ridgeOffset + 3)));
  });

  it("keeps the support boundary continuous across a stationary field", () => {
    const { pixels, width, height } = render();
    for (let y = 0; y < height; y += 1) {
      const firstAlpha = pixels[(y * width) * 4 + 3];
      for (let x = 1; x < width; x += 1) {
        expect(pixels[(y * width + x) * 4 + 3]).toBe(firstAlpha);
      }
    }
  });

  it("orders outside, slope, and ridge samples by presence", () => {
    const { pixels, width, height } = render();
    const outside = pixelAt(pixels, width, 4, 0);
    const slope = pixelAt(pixels, width, 4, Math.floor(height * 0.33));
    const ridge = pixelAt(pixels, width, 4, Math.floor(height * 0.5));
    expect(outside[3]).toBe(0);
    expect(slope[3]).toBeGreaterThan(0);
    expect(ridge[3]).toBeGreaterThan(slope[3]);
    expect(ridge.slice(0, 3)).not.toEqual(slope.slice(0, 3));
  });

  it("changes color contrast without changing alpha or support", () => {
    const subdued = render(1, {
      ...DEFAULT_TERRAIN_SETTINGS,
      colorContrast: 0,
    });
    const vivid = render(1, {
      ...DEFAULT_TERRAIN_SETTINGS,
      colorContrast: 1,
    });
    const subduedAlphas = Array.from(subdued.pixels).filter(
      (_, index) => index % 4 === 3,
    );
    const vividAlphas = Array.from(vivid.pixels).filter(
      (_, index) => index % 4 === 3,
    );
    expect(vividAlphas).toEqual(subduedAlphas);
    expect(vivid.pixels).not.toEqual(subdued.pixels);
  });

  it("changes surface contrast without changing alpha or support", () => {
    const flat = render(1, { ...DEFAULT_TERRAIN_SETTINGS, relief: 0 });
    const sculpted = render(1, { ...DEFAULT_TERRAIN_SETTINGS, relief: 1 });
    const flatAlphas = Array.from(flat.pixels).filter(
      (_, index) => index % 4 === 3,
    );
    const sculptedAlphas = Array.from(sculpted.pixels).filter(
      (_, index) => index % 4 === 3,
    );
    expect(sculptedAlphas).toEqual(flatAlphas);
    expect(sculpted.pixels).not.toEqual(flat.pixels);
  });
});
