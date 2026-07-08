import { describe, expect, it } from "vitest";
import {
  buildTerrainShadowSamples,
  resolveTerrainShadowStyle,
  terrainShadowStrength,
} from "../chart/terrain/terrainTraceShadow";

describe("terrain trace shadow", () => {
  const params = { mu: 10, sigma: 2 };

  it("vanishes at the ridge and boundary and opens across the slope", () => {
    const ridge = terrainShadowStrength(10, params, 0.01);
    const nearRidge = terrainShadowStrength(10.5, params, 0.01);
    const slope = terrainShadowStrength(12, params, 0.01);
    const outside = terrainShadowStrength(18, params, 0.01);
    expect(ridge).toBe(0);
    expect(slope).toBeGreaterThan(nearRidge);
    expect(nearRidge).toBeGreaterThan(ridge);
    expect(outside).toBe(0);
  });

  it("aligns one shadow sample to every measured observation", () => {
    const samples = buildTerrainShadowSamples(
      [
        { timestamp: 0, value: 10 },
        { timestamp: 5, value: 12 },
        { timestamp: 10, value: 18 },
      ],
      [
        { timestamp: 0, params },
        { timestamp: 10, params },
      ],
      0.01,
    );
    expect(samples.map(({ timestamp, value }) => ({ timestamp, value }))).toEqual([
      { timestamp: 0, value: 10 },
      { timestamp: 5, value: 12 },
      { timestamp: 10, value: 18 },
    ]);
    expect(samples[0].strength).toBe(0);
    expect(samples[1].strength).toBeGreaterThan(samples[0].strength);
    expect(samples[2].strength).toBe(0);
  });

  it("combines shadow blur and spread into crispness", () => {
    const soft = resolveTerrainShadowStyle(0);
    const crisp = resolveTerrainShadowStyle(1);
    expect(soft.blurPx).toBeGreaterThan(crisp.blurPx);
    expect(soft.spreadPx).toBeGreaterThan(crisp.spreadPx);
    expect(soft.blurPx).toBe(12);
    expect(soft.spreadPx).toBe(10);
    expect(soft.opacityScale).toBeLessThan(0.1);
    expect(crisp.blurPx).toBe(0);
    expect(crisp.spreadPx).toBe(0);
    expect(crisp.opacityScale).toBe(1);
    expect(soft.offsetX).toBe(crisp.offsetX);
    expect(soft.offsetY).toBe(crisp.offsetY);
  });
});
