export type DistributionStyle = "bands" | "terrain";

export interface TerrainSettings {
  ridgeDefinition: number;
  timeVsShapeBias: number;
  contourDetail: number;
  relief: number;
  presence: number;
}

export interface GaussianParams {
  mu: number;
  sigma: number;
}

export interface DistributionDescriptor<Params = GaussianParams> {
  timestamp: number;
  params: Params;
}

export interface DensityModel<Params> {
  pdf(value: number, params: Params): number;
  dpdfDy?: (value: number, params: Params) => number;
}

export type RGB = readonly [number, number, number];

export interface TerrainPalette {
  low: RGB;
  high: RGB;
  contour: RGB;
}

export interface ResolvedTerrainConfig {
  shapeGain: number;
  temporalGain: number;
  contourBandCount: number;
  contourLineStrength: number;
  ambient: number;
  shadeContrast: number;
  layerOpacity: number;
  paletteStrength: number;
  lightDirection: readonly [number, number, number];
  palette: TerrainPalette;
}
