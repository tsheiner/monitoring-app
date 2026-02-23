import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartCore } from "../chart/ChartCore";
import { ChartView } from "../chart/ChartView";
import { MonitoringApp } from "../main";
import type { APIClient } from "../api/client";
import type { BaselineResponse } from "../chart/types";
import { getMetricState, makeChartConfig, makeObs } from "./testHelpers";

function setupAppDOM(): void {
  document.body.innerHTML =
    '<div id="chart" style="width:800px;height:500px"></div>';
}

function createMockApi(overrides: Partial<APIClient> = {}): APIClient {
  let reconnectCallback: ((gapDuration: number) => void) | null = null;
  const mock = {
    fetchMetricHistory: vi.fn(
      async (metric: string, start: number, end: number) => ({
        metric,
        start,
        end,
        observations: [
          { timestamp: start, value: 10 },
          { timestamp: end, value: 20 },
        ],
        distribution: null,
      }),
    ),
    fetchBaseline: vi.fn(async () => null),
    fetchEvents: vi.fn(async (start: number, end: number) => ({
      start,
      end,
      events: [],
      count: 0,
    })),
    connectWebSocket: vi.fn(),
    onMetric: vi.fn(),
    onEvent: vi.fn(),
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onReconnect: vi.fn((cb: (gapDuration: number) => void) => {
      reconnectCallback = cb;
    }),
    __triggerReconnect: async (gapDuration: number) => {
      if (reconnectCallback) {
        await reconnectCallback(gapDuration);
      }
    },
    ...overrides,
  };

  return mock as unknown as APIClient;
}

function makeBaseline(metric: string): BaselineResponse {
  return {
    metric,
    entity: null,
    lookback_days: 30,
    timezone: "UTC",
    hourly_distributions: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      fallback_source: "self",
      sample_count: 100,
      distribution: {
        p1: 10,
        p5: 12,
        p10: 14,
        p25: 16,
        p50: 20,
        p75: 24,
        p90: 26,
        p95: 28,
        p99: 30,
        mean: 20,
        stddev: 3,
      },
    })),
  };
}

describe("Edge-case regressions", () => {
  beforeEach(() => {
    setMockedTime(1_700_000_000_000);
  });

  it("loads reconnect gap data into chart", async () => {
    setupAppDOM();
    const api = createMockApi();
    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: api,
    });

    (app as any).setupAPICallbacks();

    const loadSpy = vi.spyOn((app as any).chart, "loadHistoricalData");

    await (api as any).__triggerReconnect(60);

    expect(loadSpy).toHaveBeenCalledWith(
      "time_to_connect",
      expect.arrayContaining([
        expect.objectContaining({ value: 10 }),
        expect.objectContaining({ value: 20 }),
      ]),
    );
  });

  it("invokes onRangeChange callback once per zoom handling", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const core = new ChartCore(container, makeChartConfig(1_700_000_000));
    const callback = vi.fn();
    core.onRangeChange(callback);
    (core as any).svg.call = vi.fn();

    (core as any).handleZoom({
      sourceEvent: { type: "wheel" },
      transform: { x: 0, k: 1.5 },
    });

    expect(callback).toHaveBeenCalledTimes(1);

    container.remove();
  });

  it("restores distribution generator when returning to single metric", () => {
    const container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "500px";
    document.body.appendChild(container);

    const now = 1_700_000_000;
    const chart = new ChartView(container, makeChartConfig(now));
    chart.addMetric("time_to_connect", "#E67E22");
    chart.setBaseline("time_to_connect", makeBaseline("time_to_connect"));
    chart.loadHistoricalData(
      "time_to_connect",
      makeObs(now - 3600, now, 30, 40, 30),
    );

    chart.addMetric("throughput", "#3498DB");
    chart.loadHistoricalData(
      "throughput",
      makeObs(now - 3600, now, 400, 500, 30),
    );

    chart.removeMetric("throughput");

    const state = getMetricState(chart, "time_to_connect");
    expect(state.distributionGenerator).not.toBeNull();

    container.remove();
  });
});
