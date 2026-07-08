import { afterEach, describe, expect, it } from "vitest";
import * as d3 from "d3";
import { ChartView } from "../chart/ChartView";
import {
  Distribution,
  BaselineResponse,
  ChartConfig,
  STATUS_ZONE_COLORS,
} from "../chart/types";
import {
  DISTRIBUTION_CONTOUR_PERCENTILES,
  DistributionRibbonGenerator,
  getRibbonContourStyle,
  getDistributionValueAtPercentile,
  getRibbonBandStyle,
  isValidRibbonDistribution,
} from "../chart/generators/DistributionRibbonGenerator";

const containers: HTMLElement[] = [];

function makeDistribution(overrides: Partial<Distribution> = {}): Distribution {
  return {
    p1: 10,
    p5: 14,
    p10: 16,
    p25: 20,
    p50: 30,
    p75: 42,
    p90: 50,
    p95: 56,
    p99: 62,
    mean: 31,
    stddev: 8,
    ...overrides,
  };
}

function makeBaseline(distribution = makeDistribution()): BaselineResponse {
  return {
    metric: "throughput",
    entity: null,
    lookback_days: 30,
    timezone: "local",
    hourly_distributions: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      sample_count: 100,
      fallback_source: "data",
      distribution,
    })),
  };
}

function appendContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  return container;
}

function renderRibbon(traceColor: string, distribution = makeDistribution()) {
  const container = appendContainer();
  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", 500)
    .attr("height", 240);
  const group = svg.append("g");
  const generator = new DistributionRibbonGenerator(group, traceColor);

  generator.setScales(
    d3.scaleTime().domain([new Date(0), new Date(3600 * 1000)]).range([0, 500]),
    d3.scaleLinear().domain([0, 100]).range([240, 0]),
  );
  generator.update(
    [
      { timestamp: 0, distribution },
      { timestamp: 3600, distribution },
    ],
    [0, 3600],
  );

  return {
    container,
    bands: Array.from(container.querySelectorAll<SVGPathElement>(".ribbon-band")),
  };
}

function normalizedColor(color: string): string {
  return d3.color(color)?.formatRgb() ?? color;
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

afterEach(() => {
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

describe("DistributionRibbonGenerator", () => {
  it("derives ribbon hue from each configured metric trace color", () => {
    const metricColors = [
      "#3498DB",
      "#00BCD4",
      "#00C853",
      "#FF6B35",
      "#FFD23F",
      "#FF3366",
    ];

    for (const color of metricColors) {
      const traceHue = d3.hsl(color).h;
      const centerStyle = getRibbonBandStyle(color, 0.5);
      expect(hueDistance(centerStyle.hue, traceHue)).toBeLessThan(0.1);
    }
  });

  it("makes p50 less saturated than the trace and stronger than the tails", () => {
    const traceColor = "#00BCD4";
    const traceSaturation = d3.hsl(traceColor).s;
    const centerStyle = getRibbonBandStyle(traceColor, 0.5);
    const tailStyle = getRibbonBandStyle(traceColor, 0.08);

    expect(centerStyle.saturation).toBeLessThan(traceSaturation);
    expect(centerStyle.saturation).toBeGreaterThan(tailStyle.saturation);
    expect(centerStyle.opacity).toBeGreaterThan(tailStyle.opacity);
  });

  it("reaches full transparency at and outside p1 and p99", () => {
    const positions = [-0.25, 0, 1, 1.25];

    for (const position of positions) {
      expect(getRibbonBandStyle("#3498DB", position).opacity).toBe(0);
    }
  });

  it("sets strongest density at expectation and fades to the fence contours", () => {
    const traceColor = "#3498DB";
    const center = getRibbonBandStyle(traceColor, 0.5);
    const p5 = getRibbonBandStyle(traceColor, (5 - 1) / 98);
    const p10 = getRibbonBandStyle(traceColor, (10 - 1) / 98);
    const p75 = getRibbonBandStyle(traceColor, (75 - 1) / 98);
    const p95 = getRibbonBandStyle(traceColor, (95 - 1) / 98);
    const p99 = getRibbonBandStyle(traceColor, 1);

    expect(center.opacity).toBeCloseTo(0.8);
    expect(p10.opacity).toBeGreaterThan(p5.opacity);
    expect(p75.opacity).toBeGreaterThan(p10.opacity);
    expect(p75.opacity).toBeLessThan(center.opacity);
    expect(p5.opacity).toBe(0);
    expect(p95.opacity).toBe(0);
    expect(p99.opacity).toBe(0);
  });

  it("does not render traffic-light status colors", () => {
    const { bands } = renderRibbon("#3498DB");
    const statusColors = new Set(
      Object.values(STATUS_ZONE_COLORS).map(normalizedColor),
    );
    const renderedColors = bands.map((band) =>
      normalizedColor(band.getAttribute("fill") ?? ""),
    );

    expect(bands.length).toBeGreaterThan(20);
    expect(renderedColors.some((color) => statusColors.has(color))).toBe(false);
  });

  it("uses asymmetric percentile anchors when mapping distribution geometry", () => {
    const distribution = makeDistribution({
      p1: 0,
      p5: 2,
      p25: 8,
      p50: 16,
      p75: 54,
      p95: 90,
      p99: 100,
    });

    const lowerQuartileSpan =
      getDistributionValueAtPercentile(distribution, 50) -
      getDistributionValueAtPercentile(distribution, 25);
    const upperQuartileSpan =
      getDistributionValueAtPercentile(distribution, 75) -
      getDistributionValueAtPercentile(distribution, 50);

    expect(upperQuartileSpan).toBeGreaterThan(lowerQuartileSpan);
    expect(getDistributionValueAtPercentile(distribution, 62.5)).toBe(35);
  });

  it("preserves the measured trace path and color", () => {
    const container = appendContainer();
    const now = 1_700_000_000;
    const traceColor = "#FF6B35";
    const config: ChartConfig = {
      width: 800,
      height: 500,
      margin: { top: 20, right: 20, bottom: 40, left: 60 },
      metric: "throughput",
      timeRange: [now - 3600, now],
      showDistribution: true,
      showEvents: false,
      liveMode: false,
      colors: {
        line: traceColor,
        distribution: `${traceColor}33`,
        event: "#999",
        eventHover: "#7EC7FF",
      },
    };

    const chart = new ChartView(container, config);
    chart.addMetric("throughput", traceColor, "Throughput");
    chart.setBaseline("throughput", makeBaseline());
    chart.loadHistoricalData("throughput", [
      { timestamp: now - 3600, value: 24 },
      { timestamp: now - 1800, value: 33 },
      { timestamp: now, value: 28 },
    ]);

    const line = container.querySelector<SVGPathElement>("svg .line");
    const bands = container.querySelectorAll(".ribbon-band");
    const ribbon = container.querySelector(".distribution-ribbon");
    const lineGroup = container.querySelector(".line-generator");

    expect(line?.getAttribute("stroke")).toBe(traceColor);
    expect(line?.getAttribute("d")?.length).toBeGreaterThan(20);
    expect(bands.length).toBeGreaterThan(20);
    expect(ribbon?.parentElement?.firstElementChild).toBe(ribbon);
    expect(lineGroup?.compareDocumentPosition(ribbon as Node)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  });

  it("represents outside-footprint observations through the trace without extra rings", () => {
    const container = appendContainer();
    const now = 1_700_000_000;
    const traceColor = "#3498DB";
    const config: ChartConfig = {
      width: 800,
      height: 500,
      margin: { top: 20, right: 20, bottom: 40, left: 60 },
      metric: "time_to_connect",
      timeRange: [now - 3600, now],
      showDistribution: true,
      showEvents: false,
      liveMode: false,
      colors: {
        line: traceColor,
        distribution: `${traceColor}33`,
        event: "#999",
        eventHover: "#7EC7FF",
      },
    };

    const chart = new ChartView(container, config);
    chart.addMetric("time_to_connect", traceColor, "Time to Connect");
    chart.setBaseline(
      "time_to_connect",
      makeBaseline(
        makeDistribution({
          p1: 18,
          p5: 19,
          p25: 21,
          p50: 22,
          p75: 23,
          p95: 25,
          p99: 26,
        }),
      ),
    );
    chart.loadHistoricalData("time_to_connect", [
      { timestamp: now - 3600, value: 22 },
      { timestamp: now - 1800, value: 33 },
      { timestamp: now, value: 23 },
    ]);

    const line = container.querySelector<SVGPathElement>("svg .line");

    expect(line?.getAttribute("d")?.length).toBeGreaterThan(20);
    expect(container.querySelectorAll(".excursion-marker")).toHaveLength(0);
  });

  it("renders exactly five percentile contours", () => {
    const { container } = renderRibbon("#3498DB");
    const contours = Array.from(
      container.querySelectorAll<SVGPathElement>(".ribbon-contour"),
    );

    expect(contours).toHaveLength(5);
    expect(
      DISTRIBUTION_CONTOUR_PERCENTILES.every((percentile) =>
        container.querySelector(`.ribbon-contour-p${percentile}`),
      ),
    ).toBe(true);
  });

  it("keeps contour values ordered for valid distributions", () => {
    const distribution = makeDistribution({
      p5: 14,
      p25: 22,
      p50: 34,
      p75: 47,
      p95: 64,
      p99: 70,
    });
    const values = DISTRIBUTION_CONTOUR_PERCENTILES.map((percentile) =>
      getDistributionValueAtPercentile(distribution, percentile),
    );

    expect(isValidRibbonDistribution(distribution)).toBe(true);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("gives p50 the strongest contour treatment", () => {
    const traceColor = "#00C853";
    const p50 = getRibbonContourStyle(traceColor, 50);
    const p25 = getRibbonContourStyle(traceColor, 25);
    const p5 = getRibbonContourStyle(traceColor, 5);

    expect(p50.strokeWidth).toBeGreaterThan(p25.strokeWidth);
    expect(p25.strokeWidth).toBeGreaterThan(p5.strokeWidth);
    expect(p50.opacity).toBeGreaterThan(p25.opacity);
    expect(p25.opacity).toBeGreaterThan(p5.opacity);
  });

  it("skips invalid or crossed percentile data without invalid path output", () => {
    const { bands, container } = renderRibbon(
      "#3498DB",
      makeDistribution({ p25: 45, p50: 30 }),
    );
    const paths = [
      ...bands,
      ...Array.from(
        container.querySelectorAll<SVGPathElement>(".ribbon-contour"),
      ),
    ];

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.getAttribute("d") ?? "").not.toContain("NaN");
    }
  });

  it("does not render contours when distribution display is disabled", () => {
    const container = appendContainer();
    const now = 1_700_000_000;
    const config: ChartConfig = {
      width: 800,
      height: 500,
      margin: { top: 20, right: 20, bottom: 40, left: 60 },
      metric: "throughput",
      timeRange: [now - 3600, now],
      showDistribution: false,
      showEvents: false,
      liveMode: false,
      colors: {
        line: "#3498DB",
        distribution: "#3498DB33",
        event: "#999",
        eventHover: "#7EC7FF",
      },
    };

    const chart = new ChartView(container, config);
    chart.addMetric("throughput", "#3498DB", "Throughput");
    chart.setBaseline("throughput", makeBaseline());
    chart.loadHistoricalData("throughput", [
      { timestamp: now - 3600, value: 24 },
      { timestamp: now, value: 28 },
    ]);

    expect(container.querySelectorAll(".ribbon-contour")).toHaveLength(0);
  });
});
