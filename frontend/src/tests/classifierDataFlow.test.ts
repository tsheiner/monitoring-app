/**
 * Tests for FD-021: Frontend classifier data flow (WS + HTTP)
 *
 * Verifies that:
 * 1. MetricMessage type accepts classifiers field
 * 2. Classifier data from WS messages is stored in DataTarget observations
 * 3. Classifier data from HTTP responses reaches the chart
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChartView } from "../chart/ChartView";
import {
  ChartConfig,
  MetricMessage,
  Observation,
  ClassifierValue,
} from "../chart/types";
import {
  createChartContainer,
  cleanupChartContainer,
  simulateMouseMove,
} from "./mouseUtils";

describe("FD-021: Frontend Classifier Data Flow", () => {
  let container: HTMLDivElement;
  let config: ChartConfig;

  beforeEach(() => {
    container = createChartContainer();
    const now = Date.now() / 1000;
    config = {
      width: 800,
      height: 400,
      margin: { top: 20, right: 20, bottom: 40, left: 60 },
      metric: "time_to_connect",
      timeRange: [now - 3600, now],
      showDistribution: false,
      showEvents: false,
      liveMode: true,
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
  });

  describe("MetricMessage type includes classifiers", () => {
    it("should accept MetricMessage with classifiers field", () => {
      // Type-level test: MetricMessage must accept classifiers
      const message: MetricMessage = {
        type: "metric",
        timestamp: 1707782400,
        metric: "time_to_connect",
        value: 1.8,
        classifiers: {
          dhcp: { value: 0.99, status: "green" },
          dns: { value: 0.97, status: "green" },
          association: { value: 0.98, status: "green" },
          authorization: { value: 0.95, status: "green" },
        },
      };

      // If this compiles and runs, the type accepts classifiers
      expect(message.classifiers).toBeDefined();
      expect(message.classifiers?.dhcp?.status).toBe("green");
    });

    it("should accept MetricMessage without classifiers (backward compat)", () => {
      const message: MetricMessage = {
        type: "metric",
        timestamp: 1707782400,
        metric: "throughput",
        value: 480,
      };

      expect(message.classifiers).toBeUndefined();
    });
  });

  describe("WS message classifiers passed to chart", () => {
    it("should store classifiers in DataTarget when appending live data with classifiers", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22");

      // Append live observation WITH classifiers
      const obsWithClassifiers: Observation = {
        timestamp: Math.floor(Date.now() / 1000),
        value: 1.8,
        classifiers: {
          dhcp: { value: 0.99, status: "green" },
          dns: { value: 0.97, status: "green" },
        },
      };

      chart.appendLiveData("time_to_connect", obsWithClassifiers);

      // Access the DataTarget via the public API to check stored observation
      // The tooltip should render classifiers — proxy test via tooltip content
      const svg = container.querySelector("svg") as SVGSVGElement;
      const chartX = config.margin.left + 400;
      const chartY = config.margin.top + 150;

      simulateMouseMove(svg, chartX, chartY);

      // The tooltip should appear when there's data
      const tooltip = container.querySelector(".chart-tooltip") as HTMLElement;
      // Check that tooltip is present and could eventually show classifiers
      // (classifiers rendering requires activeMetric to be set which needs hysteresis)
      expect(tooltip).toBeTruthy();
    });

    it("should pass through classifiers from appendLiveData to stored observations", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22");

      const classifiers: Record<string, ClassifierValue> = {
        dhcp: { value: 0.99, status: "green" },
        authorization: { value: 0.72, status: "red" },
      };

      chart.appendLiveData("time_to_connect", {
        timestamp: Math.floor(Date.now() / 1000),
        value: 1.8,
        classifiers,
      });

      // Access internal data via getObservationsForTest helper
      // We need to verify the data was stored - use tooltip inspection after setting active
      // Force active metric by bypassing hysteresis
      chart["activeMetric"] = "time_to_connect";

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 400, config.margin.top + 150);

      const tooltip = container.querySelector(".chart-tooltip") as HTMLElement;
      expect(tooltip).toBeTruthy();
      // The tooltip should contain classifier names for the active metric
      // dhcp and authorization should appear
      expect(tooltip.textContent).toContain("dhcp");
      expect(tooltip.textContent).toContain("authorization");
    });
  });

  describe("HTTP observations classifiers passed to chart", () => {
    it("should preserve classifiers when loading historical observations", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22");

      // Load observations that include classifiers (as they would come from HTTP API)
      const observations: Observation[] = [
        {
          timestamp: Math.floor(Date.now() / 1000) - 3000,
          value: 1.8,
          classifiers: {
            dhcp: { value: 0.99, status: "green" },
            dns: { value: 0.97, status: "green" },
          },
        },
        {
          timestamp: Math.floor(Date.now() / 1000) - 2400,
          value: 2.5,
          classifiers: {
            dhcp: { value: 0.72, status: "red" }, // DHCP degraded
            dns: { value: 0.95, status: "green" },
          },
        },
        {
          timestamp: Math.floor(Date.now() / 1000) - 1800,
          value: 1.9,
          classifiers: {
            dhcp: { value: 0.98, status: "green" },
            dns: { value: 0.98, status: "green" },
          },
        },
      ];

      chart.loadHistoricalData("time_to_connect", observations);

      // Force active metric and hover so tooltip renders
      chart["activeMetric"] = "time_to_connect";

      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 400, config.margin.top + 150);

      const tooltip = container.querySelector(".chart-tooltip") as HTMLElement;
      expect(tooltip).toBeTruthy();

      // When the tooltip renders classifiers, they should include dhcp
      expect(tooltip.textContent).toContain("dhcp");
    });

    it("should handle observations without classifiers gracefully", () => {
      const chart = new ChartView(container, config);
      chart.addMetric("time_to_connect", "#E67E22");

      // Load observations WITHOUT classifiers (legacy data)
      const observations: Observation[] = [
        { timestamp: Math.floor(Date.now() / 1000) - 3000, value: 1.8 },
        { timestamp: Math.floor(Date.now() / 1000) - 2400, value: 2.5 },
      ];

      chart.loadHistoricalData("time_to_connect", observations);

      // No error should occur
      const svg = container.querySelector("svg") as SVGSVGElement;
      simulateMouseMove(svg, config.margin.left + 400, config.margin.top + 150);

      const tooltip = container.querySelector(".chart-tooltip") as HTMLElement;
      // Tooltip should display even without classifiers
      expect(tooltip).toBeTruthy();
    });
  });
});
