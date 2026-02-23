import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChartView } from "../chart/ChartView";
import { getMetricState, makeChartConfig, makeObs } from "./testHelpers";

describe("Range transitions", () => {
  let container: HTMLDivElement;
  let chart: ChartView;
  const now = 1_700_000_000;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "500px";
    document.body.appendChild(container);
    chart = new ChartView(container, makeChartConfig(now));
  });

  afterEach(() => {
    container.remove();
  });

  it("resets normalizedYDomain on setTimeRange", () => {
    chart.addMetric("time_to_connect", "#E67E22");
    chart.loadHistoricalData(
      "time_to_connect",
      makeObs(now - 3600, now, 30, 40, 10),
    );

    expect(
      getMetricState(chart, "time_to_connect").normalizedYDomain[0],
    ).toBeLessThan(Infinity);

    chart.setTimeRange(86400, now);

    expect(getMetricState(chart, "time_to_connect").normalizedYDomain).toEqual([
      Infinity,
      -Infinity,
    ]);
  });

  it("computes domain from new range data only", () => {
    chart.addMetric("time_to_connect", "#E67E22");
    chart.loadHistoricalData(
      "time_to_connect",
      makeObs(now - 3600, now, 30, 40, 20),
    );

    chart.setTimeRange(86400, now);
    chart.loadHistoricalData(
      "time_to_connect",
      makeObs(now - 86400, now, 20, 50, 20),
    );

    const domain = getMetricState(chart, "time_to_connect").normalizedYDomain;
    expect(domain[0]).toBeCloseTo(20, 6);
    expect(domain[1]).toBeCloseTo(50, 6);
  });

  it("resets bufferedRange on setTimeRange", () => {
    chart.addMetric("time_to_connect", "#E67E22");
    chart.loadHistoricalData(
      "time_to_connect",
      makeObs(now - 3600, now, 30, 40, 10),
    );

    expect(
      getMetricState(chart, "time_to_connect").bufferedRange,
    ).not.toBeNull();

    chart.setTimeRange(86400, now);

    expect(getMetricState(chart, "time_to_connect").bufferedRange).toBeNull();
  });

  it("does not carry stale Y-domain through 1h->24h->1h round-trip", () => {
    chart.addMetric("time_to_connect", "#E67E22");

    chart.loadHistoricalData(
      "time_to_connect",
      makeObs(now - 3600, now, 30, 38, 20),
    );

    chart.setTimeRange(86400, now);
    chart.loadHistoricalData(
      "time_to_connect",
      makeObs(now - 86400, now, 20, 50, 20),
    );

    chart.setTimeRange(3600, now);
    chart.loadHistoricalData(
      "time_to_connect",
      makeObs(now - 3600, now, 31, 37, 20),
    );

    const domain = getMetricState(chart, "time_to_connect").normalizedYDomain;
    expect(domain[0]).toBeCloseTo(31, 6);
    expect(domain[1]).toBeCloseTo(37, 6);
  });

  it("resets all metrics in a single range change", () => {
    chart.addMetric("time_to_connect", "#E67E22");
    chart.addMetric("throughput", "#3498DB");

    chart.loadHistoricalData(
      "time_to_connect",
      makeObs(now - 3600, now, 30, 40, 10),
    );
    chart.loadHistoricalData(
      "throughput",
      makeObs(now - 3600, now, 400, 500, 10),
    );

    chart.setTimeRange(86400, now);

    for (const metric of ["time_to_connect", "throughput"]) {
      const state = getMetricState(chart, metric);
      expect(state.normalizedYDomain).toEqual([Infinity, -Infinity]);
      expect(state.bufferedRange).toBeNull();
    }
  });
});
