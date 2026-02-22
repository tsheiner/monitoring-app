/**
 * Tests for FD-024: Tooltip metric state icons (positive/warning/degraded).
 *
 * Validates:
 * - Metric value within p10–p90 shows a green/positive icon (checkmark circle)
 * - Metric value at edge (p5–p10 or p90–p95) shows a yellow warning icon
 * - Metric value outside p5/p95 shows a red degraded icon
 * - Fallback to a plain colored dot when no baseline is set
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChartView } from "../chart/ChartView";
import { ChartConfig, BaselineResponse } from "../chart/types";
import {
  createChartContainer,
  cleanupChartContainer,
  simulateMouseMove,
} from "./mouseUtils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseline(
  p5: number,
  p10: number,
  p90: number,
  p95: number,
  hour = 12,
): BaselineResponse {
  return {
    metric: "time_to_connect",
    entity: null,
    lookback_days: 7,
    timezone: "UTC",
    hourly_distributions: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      distribution: {
        p1: p5 - 1,
        p5,
        p10,
        p25: (p10 + p90) / 2 - 5,
        p50: (p10 + p90) / 2,
        p75: (p10 + p90) / 2 + 5,
        p90,
        p95,
        p99: p95 + 1,
        mean: (p10 + p90) / 2,
        stddev: 5,
      },
      fallback_source: "historical",
      sample_count: 100,
    })),
  };
}

describe("FD-024: Tooltip Metric State Icons", () => {
  let container: HTMLDivElement;
  let config: ChartConfig;

  // Use a fixed timestamp where hour = 12 (UTC noon on a known day)
  // 2025-01-15 12:00:00 UTC = 1736942400
  const FIXED_TS = 1736942400;

  beforeEach(() => {
    resetMockedTime();
    setMockedTime(FIXED_TS * 1000);

    container = createChartContainer();
    config = {
      width: 800,
      height: 400,
      margin: { top: 20, right: 20, bottom: 40, left: 60 },
      metric: "time_to_connect",
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
  });

  afterEach(() => {
    cleanupChartContainer(container);
    vi.restoreAllMocks();
  });

  function getTooltip(): HTMLElement | null {
    return container.querySelector(".chart-tooltip") as HTMLElement | null;
  }

  function hoverAtCenter(chart: ChartView): void {
    chart["activeMetric"] = "time_to_connect";
    const svg = container.querySelector("svg") as SVGSVGElement;
    simulateMouseMove(svg, config.margin.left + 360, config.margin.top + 150);
  }

  // -------------------------------------------------------------------------
  // Green state
  // -------------------------------------------------------------------------

  it("test_tooltip_metric_shows_green_icon_when_within_range", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

    // p5=1.0, p10=2.0, p90=8.0, p95=9.0 — green zone: 2.0–8.0
    const baseline = makeBaseline(1.0, 2.0, 8.0, 9.0);
    chart.setBaseline("time_to_connect", baseline);

    // Value 5.0 is squarely between p10 and p90 → GREEN
    chart.loadHistoricalData("time_to_connect", [
      { timestamp: FIXED_TS - 600, value: 5.0 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip();
    expect(tooltip).toBeTruthy();
    expect(tooltip!.style.display).not.toBe("none");

    // Green icon: checkmark circle (✓ or similar) — check for the
    // CSS class "status-green" on a span, or the ✓ character.
    const html = tooltip!.innerHTML;
    expect(html).toContain("status-green");
  });

  // -------------------------------------------------------------------------
  // Yellow state
  // -------------------------------------------------------------------------

  it("test_tooltip_metric_shows_green_icon_when_low_for_lower_is_better_metric", () => {
    // For lower_is_better metrics (time_to_connect), a value below p10 is GOOD (fast = green)
    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

    // p5=2.0, p10=4.0, p90=8.0, p95=9.0
    const baseline = makeBaseline(2.0, 4.0, 8.0, 9.0);
    chart.setBaseline("time_to_connect", baseline);

    // Value 3.0 is between p5 and p10 — but lower_is_better → GREEN (fast connect)
    chart.loadHistoricalData("time_to_connect", [
      { timestamp: FIXED_TS - 600, value: 3.0 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip()!;
    const html = tooltip.innerHTML;
    expect(html).toContain("status-green");
  });

  it("test_tooltip_metric_shows_yellow_icon_when_edge_of_range_low_for_symmetric_metric", () => {
    // For symmetric metrics (capacity), low values below p10 are YELLOW
    const chart = new ChartView(container, config);
    chart.addMetric("capacity", "#E67E22", "Capacity");

    // p5=20, p10=30, p90=75, p95=85
    const baseline = makeBaseline(20, 30, 75, 85);
    chart.setBaseline("capacity", baseline);

    // Value 25 is between p5 and p10 → YELLOW (capacity too low is concerning)
    chart.loadHistoricalData("capacity", [
      { timestamp: FIXED_TS - 600, value: 25 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip()!;
    const html = tooltip.innerHTML;
    expect(html).toContain("status-yellow");
  });

  it("test_tooltip_metric_shows_yellow_icon_when_edge_of_range_high", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

    // p5=1.0, p10=2.0, p90=8.0, p95=10.0 — yellow high zone: 8.0–10.0
    const baseline = makeBaseline(1.0, 2.0, 8.0, 10.0);
    chart.setBaseline("time_to_connect", baseline);

    // Value 9.0 is between p90 and p95 → YELLOW
    chart.loadHistoricalData("time_to_connect", [
      { timestamp: FIXED_TS - 600, value: 9.0 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip()!;
    const html = tooltip.innerHTML;
    expect(html).toContain("status-yellow");
  });

  // -------------------------------------------------------------------------
  // Red state
  // -------------------------------------------------------------------------

  it("test_tooltip_metric_shows_green_icon_when_very_low_for_lower_is_better_metric", () => {
    // For lower_is_better metrics, very low values (below p5) are still GREEN (very fast)
    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

    // p5=3.0, p10=4.0, p90=8.0, p95=9.0
    const baseline = makeBaseline(3.0, 4.0, 8.0, 9.0);
    chart.setBaseline("time_to_connect", baseline);

    // Value 1.0 is below p5 — but lower_is_better → GREEN (very fast connect)
    chart.loadHistoricalData("time_to_connect", [
      { timestamp: FIXED_TS - 600, value: 1.0 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip()!;
    const html = tooltip.innerHTML;
    expect(html).toContain("status-green");
  });

  it("test_tooltip_metric_shows_red_icon_when_out_of_range_high", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

    // p5=1.0, p10=2.0, p90=8.0, p95=9.0 — red high zone: > 9.0
    const baseline = makeBaseline(1.0, 2.0, 8.0, 9.0);
    chart.setBaseline("time_to_connect", baseline);

    // Value 12.0 is above p95 → RED
    chart.loadHistoricalData("time_to_connect", [
      { timestamp: FIXED_TS - 600, value: 12.0 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip()!;
    const html = tooltip.innerHTML;
    expect(html).toContain("status-red");
  });

  // -------------------------------------------------------------------------
  // Fallback (no baseline)
  // -------------------------------------------------------------------------

  it("test_tooltip_falls_back_to_color_dot_when_no_baseline", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");
    // Do NOT call setBaseline — no baseline data

    chart.loadHistoricalData("time_to_connect", [
      { timestamp: FIXED_TS - 600, value: 5.0 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip()!;
    // Without baseline, tooltip should still show the metric row (no crash)
    expect(tooltip!.style.display).not.toBe("none");
    // Should contain a colored swatch matching the metric color
    expect(tooltip!.innerHTML).toContain("#E67E22");
  });
});
