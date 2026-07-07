import { describe, expect, it } from "vitest";
import {
  buildTerrainContactSamples,
  terrainContactStrength,
} from "../chart/terrain/terrainTraceContact";

describe("terrain trace contact", () => {
  const params = { mu: 10, sigma: 2 };

  it("is strongest on the ridge and decreases toward the support edge", () => {
    const ridge = terrainContactStrength(10, params, 0.01);
    const slope = terrainContactStrength(12, params, 0.01);
    const outside = terrainContactStrength(18, params, 0.01);
    expect(ridge).toBe(1);
    expect(slope).toBeGreaterThan(outside);
    expect(outside).toBe(0);
  });

  it("aligns one contact sample to every measured observation", () => {
    const samples = buildTerrainContactSamples(
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
    expect(samples[0].strength).toBeGreaterThan(samples[1].strength);
    expect(samples[2].strength).toBe(0);
  });
});
