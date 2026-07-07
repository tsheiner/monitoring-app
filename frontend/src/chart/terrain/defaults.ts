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
  ridgeDefinition: 0.65,
  timeVsShapeBias: 0.3,
  contourDetail: 0.5,
  relief: 0.5,
  presence: 0.45,
};

export const DEFAULT_TERRAIN_PALETTE: TerrainPalette = {
  low: [58, 68, 78],
  high: [151, 167, 179],
  contour: [31, 37, 43],
};

export function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeTerrainSettings(
  settings: TerrainSettings,
): TerrainSettings {
  return {
    ridgeDefinition: clampUnit(settings.ridgeDefinition),
    timeVsShapeBias: clampUnit(settings.timeVsShapeBias),
    contourDetail: clampUnit(settings.contourDetail),
    relief: clampUnit(settings.relief),
    presence: clampUnit(settings.presence),
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
    contourLineStrength: 0.18 - 0.08 * settings.contourDetail,
    ambient: 0.9 - 0.65 * settings.relief,
    shadeContrast: 0.75 + 1.25 * settings.relief,
    layerOpacity: 0.7 * settings.presence,
    paletteStrength: 0.25 + 0.75 * settings.presence,
    lightDirection: normalizeVector(
      -(0.2 + 0.7 * bias),
      -(0.9 - 0.7 * bias),
      0.5,
    ),
    palette: DEFAULT_TERRAIN_PALETTE,
  };
}
