import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonitoringApp } from "../main";
import type { APIClient } from "../api/client";
import type { MetricResponse } from "../chart/types";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setupAppDOM(): void {
  document.body.innerHTML =
    '<div id="chart" style="width:800px;height:500px"></div>';
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

function createMockApi(overrides: Partial<APIClient> = {}): APIClient {
  const mock = {
    fetchMetricHistory: vi.fn(
      async (metric: string, start: number, end: number) =>
        makeMetricResponse(metric, start, end),
    ),
    fetchBaseline: vi.fn(async (metric: string) => makeBaseline(metric)),
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
    ...overrides,
  };

  return mock as unknown as APIClient;
}

describe("MonitoringApp concurrency", () => {
  beforeEach(() => {
    setupAppDOM();
    setMockedTime(1_700_000_000_000);
  });

  it("discards superseded loadDataForRange call", async () => {
    const first = deferred<MetricResponse>();
    const second = deferred<MetricResponse>();

    const api = createMockApi({
      fetchMetricHistory: vi.fn(
        (metric: string, start: number, end: number) => {
          if (end - start === 10800) {
            return first.promise;
          }
          return second.promise;
        },
      ),
    });

    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: api,
    });

    const chart = (app as any).chart;
    const setTimeRangeSpy = vi.spyOn(chart, "setTimeRange");

    const now = 1_700_000_000;
    const load1 = (app as any).loadDataForRange(now - 10800, now);
    const load2 = (app as any).loadDataForRange(now - 86400, now);

    second.resolve(makeMetricResponse("time_to_connect", now - 86400, now));
    await load2;

    first.resolve(makeMetricResponse("time_to_connect", now - 10800, now));
    await load1;

    expect(setTimeRangeSpy).toHaveBeenCalledTimes(1);
    expect(setTimeRangeSpy).toHaveBeenLastCalledWith(86400, now);
  });

  it("awaits initialLoadPromise before toggling", async () => {
    const api = createMockApi();
    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: api,
    });

    const gate = deferred<void>();
    (app as any).initialLoadPromise = gate.promise;

    const togglePromise = (app as any).toggleMetric("throughput");
    await Promise.resolve();

    expect(api.fetchMetricHistory).not.toHaveBeenCalled();

    gate.resolve();
    await togglePromise;

    expect(api.fetchMetricHistory).toHaveBeenCalled();
  });

  it("drops toggle fetch result when generation changes", async () => {
    const pending = deferred<MetricResponse>();
    const api = createMockApi({
      fetchMetricHistory: vi.fn(() => pending.promise),
    });

    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: api,
    });

    (app as any).initialLoadPromise = Promise.resolve();

    const chart = (app as any).chart;
    const loadSpy = vi.spyOn(chart, "loadHistoricalData");

    const togglePromise = (app as any).toggleMetric("throughput");

    await Promise.resolve();

    (app as any)._loadGeneration += 1;
    pending.resolve(
      makeMetricResponse("throughput", 1_699_999_000, 1_700_000_000),
    );

    await togglePromise;

    expect(loadSpy).not.toHaveBeenCalledWith("throughput", expect.any(Array));
  });

  it("rapid range changes keep only final duration", async () => {
    const slow = deferred<MetricResponse>();
    const medium = deferred<MetricResponse>();
    const fast = deferred<MetricResponse>();

    const api = createMockApi({
      fetchMetricHistory: vi.fn(
        (metric: string, start: number, end: number) => {
          const duration = end - start;
          if (duration === 10800) return slow.promise;
          if (duration === 43200) return medium.promise;
          return fast.promise;
        },
      ),
    });

    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: api,
    });
    const chart = (app as any).chart;
    const setTimeRangeSpy = vi.spyOn(chart, "setTimeRange");

    const now = 1_700_000_000;
    const p1 = (app as any).loadDataForRange(now - 10800, now);
    const p2 = (app as any).loadDataForRange(now - 43200, now);
    const p3 = (app as any).loadDataForRange(now - 86400, now);

    fast.resolve(makeMetricResponse("time_to_connect", now - 86400, now));
    await p3;
    medium.resolve(makeMetricResponse("time_to_connect", now - 43200, now));
    await p2;
    slow.resolve(makeMetricResponse("time_to_connect", now - 10800, now));
    await p1;

    expect(setTimeRangeSpy).toHaveBeenCalledTimes(1);
    expect(setTimeRangeSpy).toHaveBeenLastCalledWith(86400, now);
  });
});
