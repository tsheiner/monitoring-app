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

  it("updates live terrain settings and numeric output", () => {
    document
      .querySelector<HTMLButtonElement>('[data-distribution-style="terrain"]')
      ?.click();
    const input = document.querySelector<HTMLInputElement>(
      '[data-terrain-setting="ridgeDefinition"]',
    );
    expect(input?.closest<HTMLElement>(".terrain-settings")?.hidden).toBe(false);
    if (!input) throw new Error("Ridge definition input missing");
    const previewSpy = vi.spyOn((app as any).chart, "setTerrainPreviewMode");
    input.value = "0.82";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect((app as any).chart.getTerrainSettings().ridgeDefinition).toBe(0.82);
    expect(
      document.querySelector('[data-terrain-value="ridgeDefinition"]')
        ?.textContent,
    ).toBe("0.82");
    expect(previewSpy).toHaveBeenCalledWith(true);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(previewSpy).toHaveBeenLastCalledWith(false);
  });

  it("retains session settings through style changes", () => {
    const terrain = document.querySelector<HTMLButtonElement>(
      '[data-distribution-style="terrain"]',
    );
    const bands = document.querySelector<HTMLButtonElement>(
      '[data-distribution-style="bands"]',
    );
    terrain?.click();
    const input = document.querySelector<HTMLInputElement>(
      '[data-terrain-setting="presence"]',
    );
    if (!input) throw new Error("Presence input missing");
    input.value = "0.71";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    bands?.click();
    terrain?.click();
    expect(input.value).toBe("0.71");
    expect((app as any).chart.getTerrainSettings().presence).toBe(0.71);
  });

  it("copies source-compatible settings JSON", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    document
      .querySelector<HTMLButtonElement>('[data-distribution-style="terrain"]')
      ?.click();
    document.querySelector<HTMLButtonElement>(".terrain-copy-settings")?.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());

    const copied = JSON.parse(writeText.mock.calls[0][0] ?? "{}");
    expect(Object.keys(copied)).toEqual([
      "ridgeDefinition",
      "timeVsShapeBias",
      "contourDetail",
      "relief",
      "presence",
    ]);
    await vi.waitFor(() =>
      expect(document.querySelector(".terrain-copy-feedback")?.textContent).toBe(
        "Copied",
      ),
    );
  });

  it("offers selected JSON when clipboard access is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async (_text: string) => {
          throw new Error("denied");
        }),
      },
    });
    const before = (app as any).chart.getTerrainSettings();
    document.querySelector<HTMLButtonElement>(".terrain-copy-settings")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector(".terrain-copy-feedback")?.textContent).toBe(
        "Press Ctrl/Cmd+C",
      ),
    );
    const manual = document.querySelector<HTMLTextAreaElement>(
      ".terrain-manual-copy",
    );
    expect(manual?.hidden).toBe(false);
    expect(JSON.parse(manual?.value ?? "{}")).toEqual(before);
    expect((app as any).chart.getTerrainSettings()).toEqual(before);
  });

  it("falls back to selection copy when clipboard permission is denied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async (_text: string) => {
          throw new Error("denied");
        }),
      },
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    document.querySelector<HTMLButtonElement>(".terrain-copy-settings")?.click();
    await vi.waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(document.querySelector(".terrain-copy-feedback")?.textContent).toBe(
      "Copied",
    );
  });
});
