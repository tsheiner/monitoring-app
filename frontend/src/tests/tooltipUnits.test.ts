/**
 * Tests for FD-025: Tooltip value units.
 *
 * Validates:
 * - time_to_connect values are shown with " ms" suffix, 0 decimal places
 * - throughput values are shown with " Mbps" suffix, 0 decimal places
 * - capacity / successful_connects are shown with "%" suffix, 1 decimal place
 * - coverage is shown with " dBm" suffix, 0 decimal places
 * - ap_health is shown with no unit suffix, 0 decimal places
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChartView } from "../chart/ChartView";
import { ChartConfig } from "../chart/types";
import {
  createChartContainer,
  cleanupChartContainer,
  simulateMouseMove,
} from "./mouseUtils";

describe("FD-025: Tooltip Value Units", () => {
  let container: HTMLDivElement;
  const FIXED_TS = 1736942400; // 2025-01-15 12:00:00 UTC

  function makeConfig(metric: string): ChartConfig {
    return {
      width: 800,
      height: 400,
      margin: { top: 20, right: 20, bottom: 40, left: 60 },
      metric,
      timeRange: [FIXED_TS - 3600, FIXED_TS],
      showDistribution: false,
      showEvents: false,
      liveMode: false,
      colors: {
        line: "#E67E22",
        distribution: "#E67E2233",
        event: "#999",
        eventHover: "#7EC7FF",
      },
    };
  }

  beforeEach(() => {
    resetMockedTime();
    setMockedTime(FIXED_TS * 1000);
    container = createChartContainer();
  });

  afterEach(() => {
    cleanupChartContainer(container);
    vi.restoreAllMocks();
  });

  function getTooltip(): HTMLElement | null {
    return container.querySelector(".chart-tooltip") as HTMLElement | null;
  }

  function hoverAtCenter(chart: ChartView, metricName: string): void {
    chart["activeMetric"] = metricName;
    const svg = container.querySelector("svg") as SVGSVGElement;
    simulateMouseMove(svg, makeConfig(metricName).margin.left + 360, makeConfig(metricName).margin.top + 150);
  }

  it("test_tooltip_time_to_connect_shows_ms_unit", () => {
    const chart = new ChartView(container, makeConfig("time_to_connect"));
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

    // value = 35.0 → expect "35 ms" (0 decimal places)
    chart.loadHistoricalData("time_to_connect", [
      { timestamp: FIXED_TS - 600, value: 35.0 },
    ]);

    hoverAtCenter(chart, "time_to_connect");

    const tooltip = getTooltip()!;
    expect(tooltip.textContent).toContain("35 ms");
    // Ensure no raw .toFixed(2) fallback (should NOT show "35.00")
    expect(tooltip.textContent).not.toContain("35.00");
  });

  it("test_tooltip_throughput_shows_mbps_unit", () => {
    const chart = new ChartView(container, makeConfig("throughput"));
    chart.addMetric("throughput", "#3498DB", "Throughput");

    // value = 480.0 → expect "480 Mbps" (0 decimal places)
    chart.loadHistoricalData("throughput", [
      { timestamp: FIXED_TS - 600, value: 480.0 },
    ]);

    hoverAtCenter(chart, "throughput");

    const tooltip = getTooltip()!;
    expect(tooltip.textContent).toContain("480 Mbps");
  });

  it("test_tooltip_percentage_metrics_show_percent", () => {
    const chart = new ChartView(container, makeConfig("capacity"));
    chart.addMetric("capacity", "#9B59B6", "Capacity");

    // value = 42.1 → expect "42.1%" (1 decimal place)
    chart.loadHistoricalData("capacity", [
      { timestamp: FIXED_TS - 600, value: 42.1 },
    ]);

    hoverAtCenter(chart, "capacity");

    const tooltip = getTooltip()!;
    expect(tooltip.textContent).toContain("42.1%");
  });

  it("test_tooltip_successful_connects_shows_percent", () => {
    const chart = new ChartView(container, makeConfig("successful_connects"));
    chart.addMetric("successful_connects", "#1ABC9C", "Successful Connects");

    // value = 98.2 → expect "98.2%" (1 decimal place)
    chart.loadHistoricalData("successful_connects", [
      { timestamp: FIXED_TS - 600, value: 98.2 },
    ]);

    hoverAtCenter(chart, "successful_connects");

    const tooltip = getTooltip()!;
    expect(tooltip.textContent).toContain("98.2%");
  });

  it("test_tooltip_coverage_shows_dbm_unit", () => {
    const chart = new ChartView(container, makeConfig("coverage"));
    chart.addMetric("coverage", "#2ECC71", "Coverage");

    // value = -55.0 → expect "-55 dBm" (0 decimal places)
    chart.loadHistoricalData("coverage", [
      { timestamp: FIXED_TS - 600, value: -55.0 },
    ]);

    hoverAtCenter(chart, "coverage");

    const tooltip = getTooltip()!;
    expect(tooltip.textContent).toContain("-55 dBm");
  });

  it("test_tooltip_unknown_metric_falls_back_to_two_decimal_places", () => {
    const chart = new ChartView(container, makeConfig("some_new_metric"));
    chart.addMetric("some_new_metric", "#888", "New Metric");

    // value = 3.14159 → fallback ".toFixed(2)" 
    chart.loadHistoricalData("some_new_metric", [
      { timestamp: FIXED_TS - 600, value: 3.14159 },
    ]);

    hoverAtCenter(chart, "some_new_metric");

    const tooltip = getTooltip()!;
    expect(tooltip.textContent).toContain("3.14");
  });
});
