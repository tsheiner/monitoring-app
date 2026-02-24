/**
 * Tests for FD-023: Tooltip timestamp header and display label formatting.
 *
 * Validates:
 * - Tooltip shows a formatted timestamp header as the first content
 * - Tooltip uses human-readable metric display labels (not raw keys)
 * - Timestamp format matches spec: "ddd MMM DD HH:mm"
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChartView } from "../chart/ChartView";
import { ChartConfig, Observation } from "../chart/types";
import {
  createChartContainer,
  cleanupChartContainer,
  simulateMouseMove,
} from "./mouseUtils";

describe("FD-023: Tooltip Timestamp Header and Display Labels", () => {
  let container: HTMLDivElement;
  let config: ChartConfig;
  const FIXED_TS = 1740136920; // Sat Feb 21 2026 10:42:00 UTC

  beforeEach(() => {
    resetMockedTime();
    // Fix time so tooltip timestamps are deterministic
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

  function hoverAtCenter(chart: ChartView) {
    chart["activeMetric"] = "time_to_connect";
    const svg = container.querySelector("svg") as SVGSVGElement;
    simulateMouseMove(svg, config.margin.left + 360, config.margin.top + 150);
  }

  describe("Timestamp header", () => {
    it("should show a timestamp header in the tooltip", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

      chart.loadHistoricalData("time_to_connect", [
        { timestamp: FIXED_TS - 1800, value: 1.8 },
        { timestamp: FIXED_TS - 1200, value: 2.1 },
        { timestamp: FIXED_TS - 600, value: 1.9 },
      ]);

      hoverAtCenter(chart);

      const tooltip = getTooltip();
      expect(tooltip).toBeTruthy();
      expect(tooltip!.style.display).not.toBe("none");

      // Tooltip must contain a timestamp header element
      const tsHeader = tooltip!.querySelector(".tooltip-timestamp");
      expect(tsHeader).toBeTruthy();
      expect(tsHeader!.textContent).toBeTruthy();
      // Timestamp should not be empty
      expect(tsHeader!.textContent!.trim().length).toBeGreaterThan(0);
    });

    it("should format timestamp as weekday-monthname-day-time (ddd MMM DD HH:mm)", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

      // Load a data point at the fixed timestamp
      chart.loadHistoricalData("time_to_connect", [
        { timestamp: FIXED_TS - 1800, value: 1.8 },
        { timestamp: FIXED_TS - 600, value: 1.9 },
      ]);

      hoverAtCenter(chart);

      const tooltip = getTooltip();
      const tsHeader = tooltip!.querySelector(".tooltip-timestamp");
      const text = tsHeader?.textContent ?? "";

      // Format: e.g., "Sat Feb 21 10:42" or "Fri Feb 20 18:42"
      // Match: 3-letter weekday, 3-letter month, 1-2 digit day, HH:mm
      expect(text).toMatch(
        /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}$/,
      );
    });

    it("should show the timestamp header before metric rows", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

      chart.loadHistoricalData("time_to_connect", [
        { timestamp: FIXED_TS - 600, value: 1.8 },
      ]);

      hoverAtCenter(chart);

      const tooltip = getTooltip()!;
      const children = Array.from(tooltip.querySelectorAll("[class]"));

      // Find index of timestamp vs first metric row
      const tsIndex = children.findIndex((el) =>
        el.classList.contains("tooltip-timestamp"),
      );
      const metricIndex = children.findIndex((el) =>
        el.classList.contains("tooltip-metric"),
      );

      expect(tsIndex).toBeGreaterThanOrEqual(0);
      expect(metricIndex).toBeGreaterThanOrEqual(0);
      // Timestamp header must come before metric rows
      expect(tsIndex).toBeLessThan(metricIndex);
    });
  });

  describe("Display labels", () => {
    it("should display human-readable label instead of raw metric key", () => {
      const chart = new ChartView(container, config);
      // Pass label as third argument
      chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");

      chart.loadHistoricalData("time_to_connect", [
        { timestamp: FIXED_TS - 600, value: 1.8 },
      ]);

      hoverAtCenter(chart);

      const tooltip = getTooltip();
      // Should contain the display label, not the raw key
      expect(tooltip!.textContent).toContain("Time to Connect");
      expect(tooltip!.textContent).not.toContain("time_to_connect");
    });

    it("should use raw key as fallback when no label is provided", () => {
      const chart = new ChartView(container, config);
      // No label passed
      chart.addMetric("time_to_connect", "#E67E22");

      chart.loadHistoricalData("time_to_connect", [
        { timestamp: FIXED_TS - 600, value: 1.8 },
      ]);

      hoverAtCenter(chart);

      const tooltip = getTooltip();
      // With no label, should fall back to the raw metric name
      expect(tooltip!.textContent).toContain("time_to_connect");
    });

    it("should use separate display labels for different metrics", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22", "Time to Connect");
      chart.addMetric("throughput", "#3498DB", "Throughput");

      chart.loadHistoricalData("time_to_connect", [
        { timestamp: FIXED_TS - 600, value: 1.8 },
      ]);
      chart.loadHistoricalData("throughput", [
        { timestamp: FIXED_TS - 600, value: 480 },
      ]);

      // Force active metric to time_to_connect
      chart["activeMetric"] = "time_to_connect";
      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 360, config.margin.top + 150);

      const tooltip = getTooltip();
      expect(tooltip!.textContent).toContain("Time to Connect");
      expect(tooltip!.textContent).toContain("Throughput");
      expect(tooltip!.textContent).not.toContain("time_to_connect");
      expect(tooltip!.textContent).not.toContain("throughput");
    });
  });
});
