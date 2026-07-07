import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonitoringApp } from "../main";

function setupDOM(): void {
  document.body.innerHTML = `
    <div class="sidebar-card">
      <h3>Metrics</h3>
      <div id="metrics-list"></div>
    </div>
    <div id="chart" style="width:800px;height:500px"></div>
  `;
}

function mockApi() {
  return {
    fetchMetricHistory: vi.fn(),
    fetchBaseline: vi.fn(),
    fetchClassifierBaseline: vi.fn(),
    fetchEvents: vi.fn(),
    connectWebSocket: vi.fn(),
    onMetric: vi.fn(),
    onEvent: vi.fn(),
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onReconnect: vi.fn(),
  };
}

describe("Distribution style controls", () => {
  let app: MonitoringApp;

  beforeEach(() => {
    setupDOM();
    app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: mockApi() as any,
    });
    (app as any).setupDistributionControls(
      document.getElementById("metrics-list"),
    );
  });

  it("shows Bands as the initial single-metric selection", () => {
    const section = document.getElementById("distribution-controls");
    const bands = section?.querySelector<HTMLButtonElement>(
      '[data-distribution-style="bands"]',
    );
    expect(section?.hidden).toBe(false);
    expect(bands?.getAttribute("aria-pressed")).toBe("true");
    expect((app as any).chart.getDistributionStyle()).toBe("bands");
  });

  it("switches styles without duplicating chart layers", () => {
    const chart = (app as any).chart;
    const rangeBefore = chart.getTimeRange();
    const terrain = document.querySelector<HTMLButtonElement>(
      '[data-distribution-style="terrain"]',
    );
    terrain?.click();
    expect(chart.getDistributionStyle()).toBe("terrain");
    expect(chart.getTimeRange()).toEqual(rangeBefore);
    expect(document.querySelectorAll("canvas.terrain-canvas")).toHaveLength(1);

    const bands = document.querySelector<HTMLButtonElement>(
      '[data-distribution-style="bands"]',
    );
    for (let index = 0; index < 10; index += 1) {
      bands?.click();
      terrain?.click();
    }
    expect(document.querySelectorAll("canvas.terrain-canvas")).toHaveLength(1);
  });

  it("hides controls with multiple metrics and restores the selection", () => {
    const terrain = document.querySelector<HTMLButtonElement>(
      '[data-distribution-style="terrain"]',
    );
    terrain?.click();

    const metrics = (app as any).metrics;
    metrics[1].enabled = true;
    (app as any).updateDistributionControls();
    expect(document.getElementById("distribution-controls")?.hidden).toBe(true);

    metrics[1].enabled = false;
    (app as any).updateDistributionControls();
    expect(document.getElementById("distribution-controls")?.hidden).toBe(false);
    expect(terrain?.getAttribute("aria-pressed")).toBe("true");
  });
});
