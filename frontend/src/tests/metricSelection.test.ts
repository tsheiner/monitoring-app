import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonitoringApp } from "../main";
import type { APIClient } from "../api/client";
import type { MetricResponse } from "../chart/types";

function setupAppDOM(): void {
  document.body.innerHTML = `
    <select id="time-range"><option value="43200" selected>Last 12 Hours</option></select>
    <input type="checkbox" id="live-mode" checked />
    <button id="jump-to-now"></button>
    <div id="connection-status"></div>
    <div id="data-stats"></div>
    <div id="metrics-list"></div>
    <div id="events-list"></div>
    <div id="chart" style="width:800px;height:500px"></div>
  `;
}

function makeMetricResponse(
  metric: string,
  start: number,
  end: number,
): MetricResponse {
  return {
    metric,
    start,
    end,
    observations: [
      { timestamp: start, value: 30 },
      { timestamp: end, value: 40 },
    ],
    distribution: null,
  };
}

function makeBaseline(metric: string) {
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

function makeClassifierBaseline(classifier: string) {
  return {
    classifier,
    entity: null,
    timezone: "UTC",
    hourly_distributions: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      fallback_source: "self",
      sample_count: 100,
      distribution: {
        p1: 0.8,
        p5: 0.85,
        p10: 0.9,
        p25: 0.94,
        p50: 0.97,
        p75: 0.99,
        p90: 0.995,
        p95: 0.998,
        p99: 0.999,
        mean: 0.96,
        stddev: 0.03,
      },
    })),
  };
}

function createMockApi(): APIClient {
  return {
    fetchMetricHistory: vi.fn(
      async (metric: string, start: number, end: number) =>
        makeMetricResponse(metric, start, end),
    ),
    fetchBaseline: vi.fn(async (metric: string) => makeBaseline(metric)),
    fetchClassifierBaseline: vi.fn(async (classifier: string) =>
      makeClassifierBaseline(classifier),
    ),
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
    onReconnect: vi.fn(),
  } as unknown as APIClient;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForExpectation(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  throw lastError;
}

function clickMetric(metricName: string, shiftKey = false): void {
  const toggle = document.querySelector(
    `.metric-toggle[data-metric="${metricName}"]`,
  );
  expect(toggle).toBeTruthy();
  toggle?.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      shiftKey,
    }),
  );
}

function enabledMetricNames(app: MonitoringApp): string[] {
  return (app as any).metrics
    .filter((metric: { enabled: boolean }) => metric.enabled)
    .map((metric: { name: string }) => metric.name);
}

describe("Metric selection", () => {
  beforeEach(() => {
    setupAppDOM();
    setMockedTime(1_700_000_000_000);
  });

  it("plain click switches to only the clicked metric", async () => {
    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: createMockApi(),
    });
    (app as any).setupControls();

    clickMetric("throughput");
    await waitForExpectation(() => {
      expect(enabledMetricNames(app)).toEqual(["throughput"]);
    });

    expect(enabledMetricNames(app)).toEqual(["throughput"]);
    expect((app as any).chart.hasMetric("throughput")).toBe(true);
    expect((app as any).chart.hasMetric("time_to_connect")).toBe(false);
    expect(
      document
        .querySelector('[data-metric="time_to_connect"] .metric-indicator')
        ?.classList.contains("active"),
    ).toBe(false);
    expect(
      document
        .querySelector('[data-metric="throughput"] .metric-indicator')
        ?.classList.contains("active"),
    ).toBe(true);
  });

  it("shift-click compares without removing the current metric", async () => {
    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: createMockApi(),
    });
    (app as any).setupControls();

    clickMetric("throughput", true);
    await waitForExpectation(() => {
      expect(enabledMetricNames(app)).toEqual([
        "time_to_connect",
        "throughput",
      ]);
    });

    expect(enabledMetricNames(app)).toEqual(["time_to_connect", "throughput"]);
    expect((app as any).chart.hasMetric("time_to_connect")).toBe(true);
    expect((app as any).chart.hasMetric("throughput")).toBe(true);
  });

  it("shift-click can remove a comparison metric but keeps one selected", async () => {
    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: createMockApi(),
    });
    (app as any).setupControls();

    clickMetric("throughput", true);
    await waitForExpectation(() => {
      expect(enabledMetricNames(app)).toEqual([
        "time_to_connect",
        "throughput",
      ]);
    });
    clickMetric("time_to_connect", true);
    await waitForExpectation(() => {
      expect(enabledMetricNames(app)).toEqual(["throughput"]);
    });

    expect(enabledMetricNames(app)).toEqual(["throughput"]);
    expect((app as any).chart.hasMetric("time_to_connect")).toBe(false);
    expect((app as any).chart.hasMetric("throughput")).toBe(true);

    clickMetric("throughput", true);
    await flushPromises();

    expect(enabledMetricNames(app)).toEqual(["throughput"]);
    expect((app as any).chart.hasMetric("throughput")).toBe(true);
  });

  it("keeps the current metric selected when a plain-click switch fails to load", async () => {
    const api = createMockApi();
    vi.mocked(api.fetchMetricHistory).mockRejectedValueOnce(
      new Error("network unavailable"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: api,
    });
    (app as any).setupControls();

    try {
      clickMetric("throughput");
      await waitForExpectation(() => {
        expect(api.fetchMetricHistory).toHaveBeenCalled();
      });
      await flushPromises();

      expect(enabledMetricNames(app)).toEqual(["time_to_connect"]);
      expect((app as any).chart.hasMetric("time_to_connect")).toBe(true);
      expect((app as any).chart.hasMetric("throughput")).toBe(false);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
