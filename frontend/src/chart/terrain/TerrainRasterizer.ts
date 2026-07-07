import { interpolateGaussianParams } from "./baselineAdapter";
import { resolveTerrainConfig } from "./defaults";
import { gaussianDensity } from "./GaussianDensity";
import {
  DensityModel,
  DistributionDescriptor,
  GaussianParams,
  RGB,
  TerrainSettings,
} from "./types";

export interface TerrainRasterInput<Params = GaussianParams> {
  width: number;
  height: number;
  timeRange: [number, number];
  yDomain: [number, number];
  descriptors: DistributionDescriptor<Params>[];
  referenceSigma: number;
  settings: TerrainSettings;
  densityModel?: DensityModel<Params>;
}

export interface TerrainRasterResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  contourInterval: number;
}

const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function mixColor(start: RGB, end: RGB, amount: number): [number, number, number] {
  return [
    mix(start[0], end[0], amount),
    mix(start[1], end[1], amount),
    mix(start[2], end[2], amount),
  ];
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const magnitude = Math.hypot(x, y, z) || 1;
  return [x / magnitude, y / magnitude, z / magnitude];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const normalized = clamp((value - edge0) / (edge1 - edge0));
  return normalized * normalized * (3 - 2 * normalized);
}

function densityGradient<Params>(
  model: DensityModel<Params>,
  value: number,
  params: Params,
  valuePerPixel: number,
): number {
  if (model.dpdfDy) return model.dpdfDy(value, params);
  const epsilon = Math.max(Math.abs(valuePerPixel) * 0.5, 1e-9);
  return (
    (model.pdf(value + epsilon, params) - model.pdf(value - epsilon, params)) /
    (2 * epsilon)
  );
}

export function peakDensity(sigma: number): number {
  const safeSigma = Number.isFinite(sigma) && sigma > 0 ? sigma : 1;
  return 1 / (safeSigma * SQRT_TWO_PI);
}

export function computeContourInterval(
  referenceSigma: number,
  bandCount: number,
): number {
  return peakDensity(referenceSigma) / Math.max(1, bandCount);
}

export function countPeakBands(sigma: number, contourInterval: number): number {
  return Math.floor(peakDensity(sigma) / Math.max(contourInterval, 1e-12));
}

function interpolateGenericParams<Params>(
  descriptors: DistributionDescriptor<Params>[],
  timestamp: number,
): Params | null {
  if (descriptors.length === 0) return null;
  if (timestamp <= descriptors[0].timestamp) return descriptors[0].params;
  const last = descriptors[descriptors.length - 1];
  if (timestamp >= last.timestamp) return last.params;

  // Non-Gaussian models can supply already-dense descriptor sequences. Until
  // they also supply a parameter interpolator, nearest-left is causal and safe.
  let selected = descriptors[0];
  for (const descriptor of descriptors) {
    if (descriptor.timestamp > timestamp) break;
    selected = descriptor;
  }
  return selected.params;
}

export function rasterizeTerrain<Params = GaussianParams>(
  input: TerrainRasterInput<Params>,
): TerrainRasterResult {
  const width = Math.max(0, Math.floor(input.width));
  const height = Math.max(0, Math.floor(input.height));
  const pixels = new Uint8ClampedArray(width * height * 4);
  const config = resolveTerrainConfig(input.settings);
  const contourInterval = computeContourInterval(
    input.referenceSigma,
    config.contourBandCount,
  );

  if (
    width === 0 ||
    height === 0 ||
    input.descriptors.length === 0 ||
    config.layerOpacity === 0
  ) {
    return { pixels, width, height, contourInterval };
  }

  const model =
    input.densityModel ??
    (gaussianDensity as unknown as DensityModel<Params>);
  const [startTime, endTime] = input.timeRange;
  const [domainMin, domainMax] = input.yDomain;
  const timeSpan = endTime - startTime;
  const valueSpan = domainMax - domainMin;
  const valuePerPixel = height > 1 ? valueSpan / (height - 1) : valueSpan;
  const previousDensity = new Float64Array(height);
  const currentDensity = new Float64Array(height);
  const bandDivisor = Math.max(1, Math.floor(config.contourBandCount));
  const referencePeak = peakDensity(input.referenceSigma);
  const [lightX, lightY, lightZ] = config.lightDirection;

  for (let x = 0; x < width; x += 1) {
    const timeMix = width > 1 ? x / (width - 1) : 0;
    const timestamp = startTime + timeSpan * timeMix;
    const params =
      model === (gaussianDensity as unknown as DensityModel<Params>)
        ? (interpolateGaussianParams(
            input.descriptors as unknown as DistributionDescriptor[],
            timestamp,
          ) as unknown as Params | null)
        : interpolateGenericParams(input.descriptors, timestamp);
    if (!params) continue;

    for (let y = 0; y < height; y += 1) {
      const valueMix = height > 1 ? y / (height - 1) : 0.5;
      const value = domainMax - valueSpan * valueMix;
      const density = model.pdf(value, params);
      currentDensity[y] = Number.isFinite(density) && density > 0 ? density : 0;
    }

    for (let y = 0; y < height; y += 1) {
      const density = currentDensity[y];
      if (density <= 0) continue;

      const valueMix = height > 1 ? y / (height - 1) : 0.5;
      const value = domainMax - valueSpan * valueMix;
      const derivativeY = densityGradient(model, value, params, valuePerPixel);
      const derivativeScreenY = -derivativeY * valuePerPixel;
      const derivativeScreenX = x === 0 ? 0 : density - previousDensity[y];
      const gradientX =
        (derivativeScreenX / contourInterval) * config.temporalGain;
      const gradientY =
        (derivativeScreenY / contourInterval) * config.shapeGain;
      const [normalX, normalY, normalZ] = normalize(
        -gradientX,
        -gradientY,
        1,
      );
      const directional = Math.max(
        0,
        normalX * lightX + normalY * lightY + normalZ * lightZ,
      );
      const rawShade =
        config.ambient + (1 - config.ambient) * directional;
      const shade = clamp(
        0.5 + (rawShade - 0.5) * config.shadeContrast,
        0.15,
        1.25,
      );

      const bandIndex = Math.floor(density / contourInterval);
      const bandAmount = clamp(bandIndex / bandDivisor);
      const baseColor = mixColor(
        config.palette.low,
        config.palette.high,
        bandAmount,
      );
      const grayscale =
        baseColor[0] * 0.2126 +
        baseColor[1] * 0.7152 +
        baseColor[2] * 0.0722;
      let red = mix(grayscale, baseColor[0], config.paletteStrength) * shade;
      let green = mix(grayscale, baseColor[1], config.paletteStrength) * shade;
      let blue = mix(grayscale, baseColor[2], config.paletteStrength) * shade;

      const remainder = density % contourInterval;
      const contourDistance = Math.min(
        remainder,
        contourInterval - remainder,
      );
      const pixelDensityChange =
        Math.abs(derivativeScreenX) + Math.abs(derivativeScreenY);
      const lineWidth = Math.max(
        contourInterval * 0.012,
        pixelDensityChange * 1.25,
      );
      const contourAmount =
        bandIndex > 0
          ? 1 - smoothstep(0, lineWidth, contourDistance)
          : 0;
      const contourMix = contourAmount * config.contourLineStrength;
      red = mix(red, config.palette.contour[0], contourMix);
      green = mix(green, config.palette.contour[1], contourMix);
      blue = mix(blue, config.palette.contour[2], contourMix);

      const densityPresence = smoothstep(0, contourInterval, density);
      const relativeDensity = clamp(density / referencePeak);
      const alpha =
        255 *
        config.layerOpacity *
        densityPresence *
        (0.35 + 0.65 * relativeDensity);
      const offset = (y * width + x) * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    }

    previousDensity.set(currentDensity);
  }

  return { pixels, width, height, contourInterval };
}
