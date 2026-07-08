import {
  ResolvedTerrainConfig,
  TerrainPalette,
  TerrainSettings,
} from "./types";

/**
 * Source-controlled terrain defaults.
 *
 * The Copy settings action emits this exact object shape so tuned values can
 * be pasted here directly.
 */
export const DEFAULT_TERRAIN_SETTINGS: TerrainSettings = {
  ridgeDefinition: 0.72,
  timeVsShapeBias: 0.3,
  contourDetail: 0.55,
  relief: 0.68,
  presence: 0.72,
  colorContrast: 0.78,
  distributionExtent: 0.68,
  shadowCrispness: 0.6,
};

export const DEFAULT_TERRAIN_PALETTE: TerrainPalette = {
  low: [38, 48, 76],
  middle: [91, 76, 143],
  ridge: [224, 174, 142],
  contour: [25, 24, 42],
};

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeTerrainSettings(
  settings: Partial<TerrainSettings>,
): TerrainSettings {
  return {
    ridgeDefinition: clampUnit(
      settings.ridgeDefinition ?? DEFAULT_TERRAIN_SETTINGS.ridgeDefinition,
    ),
    timeVsShapeBias: clampUnit(
      settings.timeVsShapeBias ?? DEFAULT_TERRAIN_SETTINGS.timeVsShapeBias,
    ),
    contourDetail: clampUnit(
      settings.contourDetail ?? DEFAULT_TERRAIN_SETTINGS.contourDetail,
    ),
    relief: clampUnit(settings.relief ?? DEFAULT_TERRAIN_SETTINGS.relief),
    presence: clampUnit(
      settings.presence ?? DEFAULT_TERRAIN_SETTINGS.presence,
    ),
    colorContrast: clampUnit(
      settings.colorContrast ?? DEFAULT_TERRAIN_SETTINGS.colorContrast,
    ),
    distributionExtent: clampUnit(
      settings.distributionExtent ??
        DEFAULT_TERRAIN_SETTINGS.distributionExtent,
    ),
    shadowCrispness: clampUnit(
      settings.shadowCrispness ??
        DEFAULT_TERRAIN_SETTINGS.shadowCrispness,
    ),
  };
}

function normalizeVector(
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] {
  const magnitude = Math.hypot(x, y, z) || 1;
  return [x / magnitude, y / magnitude, z / magnitude];
}

export function resolveTerrainConfig(
  input: TerrainSettings,
): ResolvedTerrainConfig {
  const settings = normalizeTerrainSettings(input);
  const bias = settings.timeVsShapeBias;

  return {
    shapeGain: 0.5 + 3.5 * settings.ridgeDefinition,
    temporalGain: 0.4 + 1.6 * bias,
    contourBandCount: 3 * 8 ** settings.contourDetail,
    contourLineStrength: 0.32 - 0.1 * settings.contourDetail,
    ambient: 0.82 - 0.68 * settings.relief,
    shadeContrast: 0.85 + 2.15 * settings.relief,
    layerOpacity: 0.92 * settings.presence,
    paletteStrength: 0.1 + 0.9 * settings.colorContrast,
    supportDensityRatio: 0.18 * 10 ** (-2 * settings.distributionExtent),
    lightDirection: normalizeVector(
      -(0.2 + 0.7 * bias),
      -(0.9 - 0.7 * bias),
      0.5,
    ),
    palette: DEFAULT_TERRAIN_PALETTE,
  };
}
