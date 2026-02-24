import { describe, expect, it } from "vitest";
import { DataTarget } from "../chart/DataTarget";

describe("DataTarget deduplication", () => {
  it("deduplicates observations by timestamp", () => {
    const dt = new DataTarget();

    dt.push([
      { timestamp: 1, value: 10 },
      { timestamp: 2, value: 20 },
      { timestamp: 3, value: 30 },
      { timestamp: 4, value: 40 },
      { timestamp: 5, value: 50 },
    ]);

    dt.push([
      { timestamp: 3, value: 31 },
      { timestamp: 4, value: 41 },
      { timestamp: 5, value: 51 },
      { timestamp: 6, value: 60 },
      { timestamp: 7, value: 70 },
    ]);

    expect(dt.count()).toBe(7);
    expect(dt.getAll().map((o) => o.timestamp)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps Y-domain correct after dedup", () => {
    const dt = new DataTarget();

    dt.push([
      { timestamp: 1, value: 10 },
      { timestamp: 2, value: 100 },
    ]);

    dt.push([
      { timestamp: 1, value: 15 },
      { timestamp: 3, value: 50 },
    ]);

    expect(dt.count()).toBe(3);
    const [yMin, yMax] = dt.getYDomain();
    expect(yMin).toBe(15);
    expect(yMax).toBe(100);
  });

  it("prevents buffer bloat for large overlapping pushes", () => {
    const dt = new DataTarget();

    const first = Array.from({ length: 400 }, (_, i) => ({
      timestamp: i + 1,
      value: i,
    }));
    const overlap = Array.from({ length: 300 }, (_, i) => ({
      timestamp: i + 100,
      value: i + 1000,
    }));

    dt.push(first);
    expect(dt.count()).toBe(400);

    dt.push(overlap);
    expect(dt.count()).toBe(400);
  });
});
