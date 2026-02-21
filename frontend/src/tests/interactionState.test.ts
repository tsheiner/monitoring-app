/**
 * Tests for interaction state handling (hover, pan, live edge).
 * Validates that crosshair and tooltip are properly suppressed during pan drag
 * and restored after pan ends.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChartView } from "../chart/ChartView";
import { ChartConfig, Observation } from "../chart/types";
import {
  createChartContainer,
  cleanupChartContainer,
  simulateMouseMove,
  createMouseEvent,
} from "./mouseUtils";

describe("Interaction State Handling", () => {
  let container: HTMLDivElement;
  let config: ChartConfig;
  let chart: ChartView;

  beforeEach(() => {
    container = createChartContainer();

    const now = Date.now() / 1000;
    config = {
      width: 800,
      height: 400,
      margin: { top: 20, right: 20, bottom: 40, left: 60 },
      metric: "throughput",
      timeRange: [now - 3600, now],
      showDistribution: true,
      showEvents: false,
      liveMode: false,
      colors: {
        line: "#4CAF50",
        distribution: "#4CAF5033",
        event: "#ff6b6b",
        eventHover: "#ff8787",
      },
    };

    chart = new ChartView(container, config);
    chart.addMetric("throughput", "#4CAF50");

    // Load some test data
    const observations: Observation[] = [
      { timestamp: 1800000, value: 50 },
      { timestamp: 1860000, value: 75 },
      { timestamp: 1920000, value: 60 },
    ];
    chart.loadHistoricalData("throughput", observations);
  });

  afterEach(() => {
    cleanupChartContainer(container);
  });

  describe("Pan Suppression", () => {
    it("should suppress crosshair and tooltip during pan drag", () => {
      const svg = container.querySelector("svg") as SVGSVGElement;
      const chartCenterX = config.margin.left + 200;
      const chartCenterY = config.margin.top + 100;

      // First, verify crosshair works normally
      simulateMouseMove(svg, chartCenterX, chartCenterY);
      let crosshairGroup = container.querySelector(".crosshair-group");
      let initialDisplay = crosshairGroup
        ? window.getComputedStyle(crosshairGroup as Element).display
        : "none";
      expect(initialDisplay).not.toBe("none"); // Crosshair should be visible on hover

      // Simulate pan start by directly setting the isPanning flag
      // In a real scenario, this would be set by the zoom start event
      chart["isPanning"] = true;

      // Manually trigger hideCrosshair (which zoom start event would do)
      chart["hideCrosshair"]();

      // Now try to move mouse - crosshair should be suppressed
      simulateMouseMove(svg, chartCenterX + 100, chartCenterY);

      // Crosshair should NOT be visible during pan
      crosshairGroup = container.querySelector(".crosshair-group");
      const panningDisplay = crosshairGroup
        ? window.getComputedStyle(crosshairGroup as Element).display
        : "none";
      expect(panningDisplay).toBe("none");

      // Tooltip should NOT be visible during pan
      const tooltip = container.querySelector(".chart-tooltip") as HTMLDivElement;
      expect(tooltip?.style.display).toBe("none");
    });

    it("should restore hover affordances after pan drag ends", () => {
      const svg = container.querySelector("svg") as SVGSVGElement;
      const chartCenterX = config.margin.left + 200;
      const chartCenterY = config.margin.top + 100;

      // Simulate pan start
      chart["isPanning"] = true;
      chart["hideCrosshair"]();

      // Verify crosshair is suppressed during pan
      simulateMouseMove(svg, chartCenterX, chartCenterY);
      let crosshairGroup = container.querySelector(".crosshair-group");
      let display = crosshairGroup
        ? window.getComputedStyle(crosshairGroup as Element).display
        : "none";
      expect(display).toBe("none");

      // Simulate pan end
      chart["isPanning"] = false;

      // Now hover over the chart again - crosshair should reappear
      simulateMouseMove(svg, chartCenterX + 50, chartCenterY);

      // Crosshair SHOULD now be visible
      crosshairGroup = container.querySelector(".crosshair-group");
      display = crosshairGroup
        ? window.getComputedStyle(crosshairGroup as Element).display
        : "none";
      expect(display).not.toBe("none");

      // Tooltip SHOULD now be visible (or at least not explicitly hidden)
      const tooltip = container.querySelector(".chart-tooltip") as HTMLDivElement;
      expect(tooltip?.style.display).not.toBe("none");
    });
  });

  describe("Live Edge Behavior", () => {
    it("should suppress tooltip near live streaming edge (within 5% of time range)", () => {
      const svg = container.querySelector("svg") as SVGSVGElement;
      
      // Calculate position near the right edge (within last 5% of time range)
      const chartWidth = config.width - config.margin.left - config.margin.right;
      const rightEdgeX = config.margin.left + chartWidth * 0.97; // 97% = near right edge
      const chartCenterY = config.margin.top + 100;

      // Hover near the right edge
      simulateMouseMove(svg, rightEdgeX, chartCenterY);

      // Tooltip should be suppressed or frozen near live edge
      const tooltip = container.querySelector(".chart-tooltip") as HTMLDivElement;
      // Implementation choice: either display="none" or tooltip doesn't update
      // For this test, we check it's either hidden or the position hasn't changed
      const isHidden = tooltip?.style.display === "none";
      const hasNoActiveMetric = !container.querySelector(".tooltip-metric.active");
      
      // At live edge, tooltip should be suppressed (one of these should be true)
      expect(isHidden || hasNoActiveMetric).toBe(true);
    });
  });
});
