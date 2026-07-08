import { describe, expect, it } from "vitest";
import { BaselineResponse, Observation } from "../chart/types";
import {
  buildTrendDisplay,
  selectTrendBucketSeconds,
} from "../chart/trend/aggregateTrend";

function observations(
  start: number,
  step: number,
  values: Array<number | null>,
): Observation[] {
  return values.flatMap((value, index) =>
    value === null ? [] : [{ timestamp: start + index * step, value }],
  );
}

function baseline(p1: number, p99: number): BaselineResponse {
  return {
    metric: "throughput",
    entity: null,
    lookback_days: 30,
    timezone: "local",
    hourly_distributions: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      sample_count: 100,
      fallback_source: "data",
      distribution: {
        p1,
        p5: p1 + 5,
        p10: p1 + 10,
        p25: p1 + 25,
        p50: (p1 + p99) / 2,
        p75: p99 - 25,
        p90: p99 - 10,
        p95: p99 - 5,
        p99,
        mean: (p1 + p99) / 2,
        stddev: 10,
      },
    })),
  };
}

describe("trend aggregation", () => {
  it("keeps raw observations for ranges up to one hour", () => {
    const range: [number, number] = [0, 3600];
    const data = observations(0, 30, [10, 20, 30]);

    const display = buildTrendDisplay(data, range, 800);

    expect(display.mode).toBe("raw");
    expect(display.bucketSeconds).toBe(0);
    expect(display.points.map((point) => point.value)).toEqual([10, 20, 30]);
    expect(display.points.every((point) => point.trendKind === "raw")).toBe(true);
  });

  it("uses deterministic bucket medians for longer ranges", () => {
    const range: [number, number] = [0, 7200];
    const data = observations(0, 30, [10, 100, 30, 40, 50]);

    const display = buildTrendDisplay(data, range, 800);

    expect(display.mode).toBe("bucketed");
    expect(display.bucketSeconds).toBe(60);
    expect(display.points.map((point) => point.value)).toEqual([55, 35, 50]);
    expect(display.points[0]).toMatchObject({
      bucketStart: 0,
      bucketEnd: 60,
      sampleCount: 2,
      minValue: 10,
      maxValue: 100,
    });
  });

  it("does not create zero values for empty buckets", () => {
    const range: [number, number] = [0, 7200];
    const data = [
      { timestamp: 0, value: 10 },
      { timestamp: 180, value: 40 },
    ];

    const display = buildTrendDisplay(data, range, 800);

    expect(display.points).toHaveLength(2);
    expect(display.points.map((point) => point.value)).toEqual([10, 40]);
  });

  it("selects wider cadence for narrower plot widths", () => {
    const range: [number, number] = [0, 24 * 3600];

    const wide = selectTrendBucketSeconds(range, 1200);
    const narrow = selectTrendBucketSeconds(range, 240);

    expect(wide).toBe(600);
    expect(narrow).toBeGreaterThan(wide);
  });

  it("decreases bucket duration as the user zooms in", () => {
    const oneDay: [number, number] = [0, 24 * 3600];
    const sixHours: [number, number] = [0, 6 * 3600];
    const oneHour: [number, number] = [0, 3600];

    expect(selectTrendBucketSeconds(sixHours, 800)).toBeLessThan(
      selectTrendBucketSeconds(oneDay, 800),
    );
    expect(selectTrendBucketSeconds(oneHour, 800)).toBe(0);
  });

  it("marks raw p1/p99 excursions even when bucket median remains in range", () => {
    const range: [number, number] = [0, 7200];
    const data = observations(0, 30, [50, 120, 50, 50]);

    const display = buildTrendDisplay(data, range, 800, baseline(0, 100));

    expect(display.points[0].value).toBe(85);
    expect(display.excursions).toHaveLength(1);
    expect(display.excursions[0]).toMatchObject({
      timestamp: 30,
      value: 120,
      sampleCount: 1,
    });
  });

  it("groups adjacent outside observations into one episode", () => {
    const range: [number, number] = [0, 7200];
    const data = observations(0, 30, [120, 130, 50, 120]);

    const display = buildTrendDisplay(data, range, 800, baseline(0, 100));

    expect(display.excursions).toHaveLength(1);
    expect(display.excursions[0]).toMatchObject({
      sampleCount: 3,
      sourceStartTimestamp: 0,
      sourceEndTimestamp: 90,
      minValue: 120,
      maxValue: 130,
    });
  });

  it("does not mutate raw observations", () => {
    const range: [number, number] = [0, 7200];
    const data = observations(0, 30, [10, 20, 30]);
    const before = JSON.stringify(data);

    buildTrendDisplay(data, range, 800);

    expect(JSON.stringify(data)).toBe(before);
  });
});
