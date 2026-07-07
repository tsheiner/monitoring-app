import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChartView } from "../chart/ChartView";
import { BaselineResponse } from "../chart/types";
import { makeChartConfig, makeObs } from "./testHelpers";

function baseline(metric: string): BaselineResponse {
  return {
    metric,
    entity: null,
    lookback_days: 30,
    timezone: "local",
    hourly_distributions: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      distribution: {
        p1: 20 + hour,
        p5: 22 + hour,
        p10: 24 + hour,
        p25: 26 + hour,
        p50: 30 + hour,
        p75: 34 + hour,
        p90: 36 + hour,
        p95: 38 + hour,
        p99: 40 + hour,
        mean: 30 + hour,
        stddev: 4,
      },
      fallback_source: "data",
      sample_count: 30,
    })),
  };
}

describe("Terrain chart integration", () => {
  let container: HTMLDivElement;
  let chart: ChartView;
  const now = new Date(2025, 0, 1, 12).getTime() / 1000;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    chart = new ChartView(container, makeChartConfig(now));
    chart.addMetric("time_to_connect", "#3498DB");
    chart.setBaseline("time_to_connect", baseline("time_to_connect"));
    chart.loadHistoricalData(
      "time_to_connect",
      makeObs(now - 3600, now, 30, 40, 20),
    );
  });

  afterEach(() => {
    chart.destroy();
    container.remove();
  });

  it("mounts one pointer-transparent canvas beneath the SVG", () => {
    const state = chart._getTerrainStateForTest();
    expect(container.querySelectorAll("canvas.terrain-canvas")).toHaveLength(1);
    expect(state.canvas.style.pointerEvents).toBe("none");
    expect(container.firstElementChild).toBe(state.canvas);
    expect(state.canvas.nextElementSibling?.tagName.toLowerCase()).toBe("svg");
    expect(state.visible).toBe(false);
  });

  it("renders terrain programmatically without changing observations", () => {
    const before = chart
      ._getMetricStateForTest("time_to_connect")
      ?.dataTarget.getAll();
    chart.setDistributionStyle("terrain");
    chart._getTerrainStateForTest().flush();
    const state = chart._getTerrainStateForTest();
    const after = chart
      ._getMetricStateForTest("time_to_connect")
      ?.dataTarget.getAll();
    expect(state.visible).toBe(true);
    expect(state.canvas.style.display).toBe("block");
    expect(after).toEqual(before);
  });

  it("hides terrain for multiple metrics and restores it afterward", () => {
    chart.setDistributionStyle("terrain");
    expect(chart._getTerrainStateForTest().visible).toBe(true);
    chart.addMetric("throughput", "#00D9FF");
    chart.loadHistoricalData(
      "throughput",
      makeObs(now - 3600, now, 400, 500, 20),
    );
    expect(chart._getTerrainStateForTest().visible).toBe(false);
    chart.removeMetric("throughput");
    expect(chart._getTerrainStateForTest().visible).toBe(true);
    expect(chart.getDistributionStyle()).toBe("terrain");
  });

  it("updates canvas geometry on resize", () => {
    chart.resize(1000, 600);
    const canvas = chart._getTerrainStateForTest().canvas;
    expect(canvas.style.left).toBe("60px");
    expect(canvas.style.top).toBe("20px");
    expect(canvas.style.width).toBe("920px");
    expect(canvas.style.height).toBe("540px");
  });

  it("removes the canvas during chart destruction", () => {
    chart.destroy();
    expect(container.querySelector("canvas.terrain-canvas")).toBeNull();
    // Keep afterEach idempotent.
    chart = new ChartView(container, makeChartConfig(now));
  });
});
