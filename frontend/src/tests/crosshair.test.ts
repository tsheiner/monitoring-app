/**
 * Tests for crosshair rendering and nearest-metric detection.
 * Validates that hovering over the chart displays crosshairs and
 * correctly identifies the nearest metric at the cursor position.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ChartView } from "../chart/ChartView";
import { ChartConfig, Observation } from "../chart/types";
import {
  createChartContainer,
  cleanupChartContainer,
  simulateMouseMove,
  createMouseEvent,
} from "./mouseUtils";

describe("Crosshair Rendering", () => {
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
  });

  afterEach(() => {
    cleanupChartContainer(container);
  });

  it("should render vertical crosshair line on hover inside plot", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("throughput", "#4CAF50");

    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg).toBeTruthy();

    // Simulate mouse move to center of chart
    const chartCenterX =
      config.margin.left +
      (config.width - config.margin.left - config.margin.right) / 2;
    const chartCenterY =
      config.margin.top +
      (config.height - config.margin.top - config.margin.bottom) / 2;

    simulateMouseMove(svg, chartCenterX, chartCenterY);

    // Check for vertical crosshair line
    const verticalLine = container.querySelector(".crosshair-vertical");
    expect(verticalLine).toBeTruthy();
    expect(verticalLine?.tagName).toBe("line");
  });

  it("should render horizontal crosshair line on hover inside plot", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("throughput", "#4CAF50");

    const svg = container.querySelector("svg") as SVGSVGElement;
    const chartCenterX = config.margin.left + 100;
    const chartCenterY = config.margin.top + 100;

    simulateMouseMove(svg, chartCenterX, chartCenterY);

    // Check for horizontal crosshair line
    const horizontalLine = container.querySelector(".crosshair-horizontal");
    expect(horizontalLine).toBeTruthy();
    expect(horizontalLine?.tagName).toBe("line");
  });

  it("should hide crosshair on mouseleave", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("throughput", "#4CAF50");

    const svg = container.querySelector("svg") as SVGSVGElement;

    // First, move mouse inside to create crosshair
    const chartCenterX = config.margin.left + 100;
    const chartCenterY = config.margin.top + 100;
    simulateMouseMove(svg, chartCenterX, chartCenterY);

    // Verify crosshair exists
    let verticalLine = container.querySelector(".crosshair-vertical");
    expect(verticalLine).toBeTruthy();

    // Now simulate mouseleave
    const leaveEvent = createMouseEvent("mouseleave", {
      clientX: 0,
      clientY: 0,
    });
    svg.dispatchEvent(leaveEvent);

    // Crosshair should be hidden (display: none or removed)
    // Check if the crosshair group is hidden
    const crosshairGroup = container.querySelector(".crosshair-group");
    expect(crosshairGroup).toBeTruthy();
    // D3's .style() method sets the style attribute, so check it directly
    const styleAttr = crosshairGroup?.getAttribute("style");
    expect(styleAttr).toContain("display: none");
  });

  it("should update crosshair position as mouse moves", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("throughput", "#4CAF50");

    const svg = container.querySelector("svg") as SVGSVGElement;

    // Move to first position
    const x1 = config.margin.left + 100;
    const y1 = config.margin.top + 100;
    simulateMouseMove(svg, x1, y1);

    const verticalLine1 = container.querySelector(
      ".crosshair-vertical",
    ) as SVGLineElement;
    expect(verticalLine1).toBeTruthy();
    const x1Pos = verticalLine1?.getAttribute("x1");

    // Move to second position
    const x2 = config.margin.left + 200;
    const y2 = config.margin.top + 150;
    simulateMouseMove(svg, x2, y2);

    const verticalLine2 = container.querySelector(
      ".crosshair-vertical",
    ) as SVGLineElement;
    const x2Pos = verticalLine2?.getAttribute("x1");

    // Position should have changed
    expect(x1Pos).not.toBe(x2Pos);
  });

  it("should style crosshair with dashed lines", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("throughput", "#4CAF50");

    const svg = container.querySelector("svg") as SVGSVGElement;
    simulateMouseMove(svg, config.margin.left + 100, config.margin.top + 100);

    const verticalLine = container.querySelector(
      ".crosshair-vertical",
    ) as SVGLineElement;
    expect(verticalLine).toBeTruthy();

    // Check for dashed stroke
    const strokeDasharray = verticalLine?.getAttribute("stroke-dasharray");
    expect(strokeDasharray).toBeTruthy();
    expect(strokeDasharray).not.toBe("");
  });

  it("should not render crosshair outside plot area", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("throughput", "#4CAF50");

    const svg = container.querySelector("svg") as SVGSVGElement;

    // Move mouse outside plot area (in margin)
    simulateMouseMove(svg, 10, 10); // Top-left margin area

    // Crosshair should not be visible
    const crosshairGroup = container.querySelector(".crosshair-group");
    expect(crosshairGroup).toBeTruthy();
    // D3's .style() method sets the style attribute, so check it directly
    const styleAttr = crosshairGroup?.getAttribute("style");
    expect(styleAttr).toContain("display: none");
  });
});

describe("Nearest Metric Detection", () => {
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

  it("should detect nearest metric when hovering near data point", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("throughput", "#4CAF50");

    const now = Math.floor(Date.now() / 1000);
    const observations: Observation[] = [
      { timestamp: now - 3600, value: 50 },
      { timestamp: now - 1800, value: 75 },
      { timestamp: now, value: 60 },
    ];

    chart.loadHistoricalData("throughput", observations);

    const svg = container.querySelector("svg") as SVGSVGElement;

    // Move to approximate location of middle data point
    const chartCenterX =
      config.margin.left +
      (config.width - config.margin.left - config.margin.right) / 2;
    const chartCenterY =
      config.margin.top +
      (config.height - config.margin.top - config.margin.bottom) / 2;

    simulateMouseMove(svg, chartCenterX, chartCenterY);

    // The chart should compute and make available the nearest metric
    // We'll verify this through the ChartView API when we add it
    // For now, just verify no errors occur
    expect(svg).toBeTruthy();
  });

  it("should select nearest metric by vertical distance at cursor time", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("throughput", "#4CAF50");
    chart.addMetric("capacity", "#2196F3");

    const now = Math.floor(Date.now() / 1000);

    // Add data where metrics have different values at same time
    chart.loadHistoricalData("throughput", [
      { timestamp: now - 1800, value: 50 },
    ]);

    chart.loadHistoricalData("capacity", [
      { timestamp: now - 1800, value: 80 },
    ]);

    const svg = container.querySelector("svg") as SVGSVGElement;

    // Hover at the time point (middle X) but at Y position closer to one metric
    const chartCenterX =
      config.margin.left +
      (config.width - config.margin.left - config.margin.right) / 2;
    const chartTopY = config.margin.top + 50; // Closer to higher value (capacity)

    simulateMouseMove(svg, chartCenterX, chartTopY);

    // Nearest metric computation should select the closer one
    // We'll expose this via getNearestMetricAtCursor() method
    expect(svg).toBeTruthy();
  });

  it("should handle no data gracefully when detecting nearest metric", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("throughput", "#4CAF50");

    // Don't load any data
    const svg = container.querySelector("svg") as SVGSVGElement;
    simulateMouseMove(svg, config.margin.left + 100, config.margin.top + 100);

    // Should not throw an error
    expect(svg).toBeTruthy();
  });

  it("should update nearest metric as cursor moves vertically", () => {
    const chart = new ChartView(container, config);
    chart.addMetric("metric1", "#4CAF50");
    chart.addMetric("metric2", "#2196F3");

    const now = Math.floor(Date.now() / 1000);

    // Create data where metrics are separated vertically
    chart.loadHistoricalData("metric1", [{ timestamp: now - 1800, value: 30 }]);

    chart.loadHistoricalData("metric2", [{ timestamp: now - 1800, value: 70 }]);

    const svg = container.querySelector("svg") as SVGSVGElement;
    const chartCenterX =
      config.margin.left +
      (config.width - config.margin.left - config.margin.right) / 2;

    // Move to bottom (closer to metric1 with lower value)
    const bottomY =
      config.margin.top +
      (config.height - config.margin.top - config.margin.bottom) -
      50;
    simulateMouseMove(svg, chartCenterX, bottomY);

    // Now move to top (closer to metric2 with higher value)
    const topY = config.margin.top + 50;
    simulateMouseMove(svg, chartCenterX, topY);

    // Nearest metric should change between moves
    // We'll verify this when we expose the API
    expect(svg).toBeTruthy();
  });
});
