/**
 * Tests for FD-022: Vertical indicator visual spec.
 *
 * Validates:
 * - Vertical line is solid (no stroke-dasharray)
 * - No horizontal crosshair line (removed per spec)
 * - Highlighted dots on metric traces at crosshair x position
 * - Dot color matches metric trace color
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChartView } from "../chart/ChartView";
import { ChartConfig, Observation } from "../chart/types";
import {
  createChartContainer,
  cleanupChartContainer,
  simulateMouseMove,
} from "./mouseUtils";

describe("FD-022: Vertical Indicator Visual Spec", () => {
  let container: HTMLDivElement;
  let config: ChartConfig;

  beforeEach(() => {
    resetMockedTime();
    setMockedTime(Date.now());

    container = createChartContainer();

    const now = Math.floor(Date.now() / 1000);
    config = {
      width: 800,
      height: 400,
      margin: { top: 20, right: 20, bottom: 40, left: 60 },
      metric: "throughput",
      timeRange: [now - 3600, now],
      showDistribution: false,
      showEvents: false,
      liveMode: false,
      colors: {
        line: "#4CAF50",
        distribution: "#4CAF5033",
        event: "#ff6b6b",
        eventHover: "#ff8787",
      },
    };
  });

  afterEach(() => {
    cleanupChartContainer(container);
  });

  describe("Vertical line style", () => {
    it("should NOT have stroke-dasharray on vertical crosshair line (solid not dashed)", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("throughput", "#4CAF50");

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 200, config.margin.top + 100);

      const verticalLine = container.querySelector(
        ".crosshair-vertical",
      ) as SVGLineElement;
      expect(verticalLine).toBeTruthy();

      // Must NOT have a stroke-dasharray attribute (solid line)
      const dashArray = verticalLine.getAttribute("stroke-dasharray");
      expect(dashArray).toBeNull();
    });

    it("should render vertical line visible on hover", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("throughput", "#4CAF50");

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 200, config.margin.top + 100);

      const verticalLine = container.querySelector(".crosshair-vertical");
      expect(verticalLine).toBeTruthy();

      const crosshairGroup = container.querySelector(".crosshair-group");
      const style = crosshairGroup?.getAttribute("style") ?? "";
      expect(style).not.toContain("display: none");
    });
  });

  describe("No horizontal crosshair line", () => {
    it("should NOT render a horizontal crosshair line", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("throughput", "#4CAF50");

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 200, config.margin.top + 100);

      // Horizontal line must not exist
      const horizontalLine = container.querySelector(".crosshair-horizontal");
      expect(horizontalLine).toBeNull();
    });
  });

  describe("Highlighted dots on metric traces", () => {
    it("should render a crosshair dot container when hovering with data", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("throughput", "#4CAF50");

      const now = Math.floor(Date.now() / 1000);
      const observations: Observation[] = [
        { timestamp: now - 1800, value: 50 },
        { timestamp: now - 1200, value: 75 },
        { timestamp: now - 600, value: 60 },
      ];
      chart.loadHistoricalData("throughput", observations);

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 200, config.margin.top + 100);

      // The crosshair-dots group should exist inside the crosshair group
      const dotsGroup = container.querySelector(".crosshair-dots");
      expect(dotsGroup).toBeTruthy();
    });

    it("should render a dot for each visible metric at hover position", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("throughput", "#3498DB");

      const now = Math.floor(Date.now() / 1000);
      chart.loadHistoricalData("throughput", [
        { timestamp: now - 1800, value: 50 },
        { timestamp: now - 1200, value: 75 },
        { timestamp: now - 600, value: 60 },
      ]);

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 200, config.margin.top + 100);

      // Should have exactly one dot (one metric)
      const dots = container.querySelectorAll(".crosshair-dot");
      expect(dots.length).toBeGreaterThan(0);
    });

    it("should render a dot for each of two visible metrics", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("throughput", "#3498DB");
      chart.addMetric("capacity", "#9B59B6");

      const now = Math.floor(Date.now() / 1000);
      chart.loadHistoricalData("throughput", [
        { timestamp: now - 1800, value: 50 },
        { timestamp: now - 1200, value: 75 },
      ]);
      chart.loadHistoricalData("capacity", [
        { timestamp: now - 1800, value: 30 },
        { timestamp: now - 1200, value: 45 },
      ]);

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 200, config.margin.top + 100);

      const dots = container.querySelectorAll(".crosshair-dot");
      expect(dots.length).toBe(2);
    });

    it("should render dot with correct color matching metric trace color", () => {
      const chart = new ChartView(container, config);
      const metricColor = "#3498DB";
      chart.addMetric("throughput", metricColor);

      const now = Math.floor(Date.now() / 1000);
      chart.loadHistoricalData("throughput", [
        { timestamp: now - 1800, value: 50 },
        { timestamp: now - 600, value: 60 },
      ]);

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 200, config.margin.top + 100);

      const dot = container.querySelector(".crosshair-dot") as SVGCircleElement;
      expect(dot).toBeTruthy();

      // Circle fill must match metric color
      const fill = dot.getAttribute("fill");
      expect(fill).toBe(metricColor);
    });

    it("should give dots a 5.5px radius for the knockout treatment", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("throughput", "#3498DB");

      const now = Math.floor(Date.now() / 1000);
      chart.loadHistoricalData("throughput", [
        { timestamp: now - 1800, value: 50 },
        { timestamp: now - 600, value: 60 },
      ]);

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 200, config.margin.top + 100);

      const dot = container.querySelector(".crosshair-dot") as SVGCircleElement;
      expect(dot).toBeTruthy();
      expect(dot.getAttribute("r")).toBe("5.5");
    });

    it("should hide dots when crosshair hides (mouseleave)", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("throughput", "#3498DB");

      const now = Math.floor(Date.now() / 1000);
      chart.loadHistoricalData("throughput", [
        { timestamp: now - 600, value: 50 },
      ]);

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 200, config.margin.top + 100);

      // Dots visible
      let crosshairGroup = container.querySelector(".crosshair-group");
      expect(crosshairGroup?.getAttribute("style") ?? "").not.toContain(
        "display: none",
      );

      // Mouseleave
      svg.dispatchEvent(new MouseEvent("mouseleave"));

      // Crosshair group (which includes dots) hides
      crosshairGroup = container.querySelector(".crosshair-group");
      expect(crosshairGroup?.getAttribute("style")).toContain("display: none");
    });
  });
});
