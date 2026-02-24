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
  p25: number,
  p75: number,
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
        p25,
        p50: (p25 + p75) / 2,
        p75,
        p90,
        p95,
        p99: p95 + 1,
        mean: (p25 + p75) / 2,
        stddev: (p75 - p25) / 2,
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

    // p5=1.0, p10=2.0, p25=4.0, p75=6.0, p90=8.0, p95=9.0 — green zone: p25–p75 (4.0–6.0)
    const baseline = makeBaseline(1.0, 2.0, 4.0, 6.0, 8.0, 9.0);
    chart.setBaseline("time_to_connect", baseline);

    // Value 5.0 is squarely in p25–p75 (4.0–6.0) → GREEN
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

  it("test_tooltip_metric_shows_yellow_icon_when_low_for_formerly_lower_is_better_metric", () => {
    // Polarity removed: value in p10–p25 zone is now YELLOW for all metrics
    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

    // p5=1.0, p10=2.0, p25=4.0, p75=6.0, p90=8.0, p95=9.0
    const baseline = makeBaseline(1.0, 2.0, 4.0, 6.0, 8.0, 9.0);
    chart.setBaseline("time_to_connect", baseline);

    // Value 3.0 is between p10(2.0) and p25(4.0) → YELLOW (no longer green: polarity removed)
    chart.loadHistoricalData("time_to_connect", [
      { timestamp: FIXED_TS - 600, value: 3.0 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip()!;
    const html = tooltip.innerHTML;
    expect(html).toContain("status-yellow");
  });

  it("test_tooltip_metric_shows_yellow_icon_when_edge_of_range_low_for_symmetric_metric", () => {
    // For symmetric metrics (capacity), low values below p10 are YELLOW
    const chart = new ChartView(container, config);
    chart.addMetric("capacity", "#E67E22", "Capacity");

    // p5=20, p10=30, p25=40, p75=65, p90=75, p95=85
    const baseline = makeBaseline(20, 30, 40, 65, 75, 85);
    chart.setBaseline("capacity", baseline);

    // Value 35 is between p10(30) and p25(40) → YELLOW
    chart.loadHistoricalData("capacity", [
      { timestamp: FIXED_TS - 600, value: 35 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip()!;
    const html = tooltip.innerHTML;
    expect(html).toContain("status-yellow");
  });

  it("test_tooltip_metric_shows_yellow_icon_when_edge_of_range_high", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

    // p5=1.0, p10=2.0, p25=4.0, p75=7.0, p90=8.0, p95=10.0 — yellow high zone: p75–p90 (7.0–8.0)
    const baseline = makeBaseline(1.0, 2.0, 4.0, 7.0, 8.0, 10.0);
    chart.setBaseline("time_to_connect", baseline);

    // Value 7.5 is between p75(7.0) and p90(8.0) → YELLOW
    chart.loadHistoricalData("time_to_connect", [
      { timestamp: FIXED_TS - 600, value: 7.5 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip()!;
    const html = tooltip.innerHTML;
    expect(html).toContain("status-yellow");
  });

  // -------------------------------------------------------------------------
  // Red state
  // -------------------------------------------------------------------------

  it("test_tooltip_metric_shows_red_icon_when_very_low_for_formerly_lower_is_better_metric", () => {
    // Polarity removed: value below p10 is now RED for all metrics
    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

    // p5=3.0, p10=4.0, p25=6.0, p75=7.0, p90=8.0, p95=9.0
    const baseline = makeBaseline(3.0, 4.0, 6.0, 7.0, 8.0, 9.0);
    chart.setBaseline("time_to_connect", baseline);

    // Value 1.0 is below p10(4.0) → RED (no longer green: polarity removed)
    chart.loadHistoricalData("time_to_connect", [
      { timestamp: FIXED_TS - 600, value: 1.0 },
    ]);

    hoverAtCenter(chart);

    const tooltip = getTooltip()!;
    const html = tooltip.innerHTML;
    expect(html).toContain("status-red");
  });

  it("test_tooltip_metric_shows_red_icon_when_out_of_range_high", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

    // p5=1.0, p10=2.0, p25=4.0, p75=6.0, p90=8.0, p95=9.0 — red zone: > p90(8.0)
    const baseline = makeBaseline(1.0, 2.0, 4.0, 6.0, 8.0, 9.0);
    chart.setBaseline("time_to_connect", baseline);

    // Value 12.0 is above p90(8.0) → RED
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

  // -------------------------------------------------------------------------
  // Symmetric status thresholds (p25/p10)
  // Baseline for all tests: p5=1, p10=2, p25=4, p75=6, p90=8, p95=9
  //   Green zone:       p25–p75  (4–6)
  //   Yellow low zone:  p10–p25  (2–4)
  //   Yellow high zone: p75–p90  (6–8)
  //   Red zone:         < p10 or > p90  (< 2 or > 8)
  // -------------------------------------------------------------------------

  describe("Symmetric status thresholds (p25/p10)", () => {
    const SYM_BASELINE = makeBaseline(1.0, 2.0, 4.0, 6.0, 8.0, 9.0);

    it("green_within_p25_p75_for_time_to_connect", () => {
      // Formerly lower_is_better — should still be green when squarely inside the band
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");
      chart.setBaseline("time_to_connect", SYM_BASELINE);
      chart.loadHistoricalData("time_to_connect", [
        { timestamp: FIXED_TS - 600, value: 5.0 }, // 4 < 5.0 < 6 → green
      ]);
      hoverAtCenter(chart);
      expect(getTooltip()!.innerHTML).toContain("status-green");
    });

    it("yellow_on_low_tail_p10_p25", () => {
      // Value in p10–p25 zone → yellow for time_to_connect (was green with lower_is_better)
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");
      chart.setBaseline("time_to_connect", SYM_BASELINE);
      chart.loadHistoricalData("time_to_connect", [
        { timestamp: FIXED_TS - 600, value: 3.0 }, // p10(2) < 3.0 < p25(4) → yellow
      ]);
      hoverAtCenter(chart);
      expect(getTooltip()!.innerHTML).toContain("status-yellow");
    });

    it("yellow_on_high_tail_p75_p90", () => {
      // Value in p75–p90 zone → yellow for throughput (was green with higher_is_better)
      const chart = new ChartView(container, { ...config, metric: "throughput" });
      chart.addMetric("throughput", "#3498DB", "Throughput");
      chart.setBaseline("throughput", { ...SYM_BASELINE, metric: "throughput" });
      chart.loadHistoricalData("throughput", [
        { timestamp: FIXED_TS - 600, value: 7.0 }, // p75(6) < 7.0 < p90(8) → yellow
      ]);
      chart["activeMetric"] = "throughput";
      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 360, config.margin.top + 150);
      expect(getTooltip()!.innerHTML).toContain("status-yellow");
    });

    it("red_below_p10_for_time_to_connect", () => {
      // Value below p10 → red for time_to_connect (was green with lower_is_better)
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");
      chart.setBaseline("time_to_connect", SYM_BASELINE);
      chart.loadHistoricalData("time_to_connect", [
        { timestamp: FIXED_TS - 600, value: 1.5 }, // 1.5 < p10(2) → red
      ]);
      hoverAtCenter(chart);
      expect(getTooltip()!.innerHTML).toContain("status-red");
    });

    it("red_above_p90_for_throughput", () => {
      // Value above p90 → red for throughput (was green with higher_is_better)
      const chart = new ChartView(container, { ...config, metric: "throughput" });
      chart.addMetric("throughput", "#3498DB", "Throughput");
      chart.setBaseline("throughput", { ...SYM_BASELINE, metric: "throughput" });
      chart.loadHistoricalData("throughput", [
        { timestamp: FIXED_TS - 600, value: 9.0 }, // 9.0 > p90(8) → red
      ]);
      chart["activeMetric"] = "throughput";
      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 360, config.margin.top + 150);
      expect(getTooltip()!.innerHTML).toContain("status-red");
    });

    it("polarity_removal_time_to_connect_below_p10_is_red_not_green", () => {
      // Explicit polarity removal proof: time_to_connect below p10 must be RED
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");
      chart.setBaseline("time_to_connect", SYM_BASELINE);
      chart.loadHistoricalData("time_to_connect", [
        { timestamp: FIXED_TS - 600, value: 0.5 }, // well below p10(2) → red
      ]);
      hoverAtCenter(chart);
      const html = getTooltip()!.innerHTML;
      expect(html).toContain("status-red");
      expect(html).not.toContain("status-green");
    });

    it("polarity_removal_throughput_above_p90_is_red_not_green", () => {
      // Explicit polarity removal proof: throughput above p90 must be RED
      const chart = new ChartView(container, { ...config, metric: "throughput" });
      chart.addMetric("throughput", "#3498DB", "Throughput");
      chart.setBaseline("throughput", { ...SYM_BASELINE, metric: "throughput" });
      chart.loadHistoricalData("throughput", [
        { timestamp: FIXED_TS - 600, value: 10.0 }, // well above p90(8) → red
      ]);
      chart["activeMetric"] = "throughput";
      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 360, config.margin.top + 150);
      const html = getTooltip()!.innerHTML;
      expect(html).toContain("status-red");
      expect(html).not.toContain("status-green");
    });
  });
});
