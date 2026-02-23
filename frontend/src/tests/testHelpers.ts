import { ChartConfig, Observation } from "../chart/types";
import { ChartView } from "../chart/ChartView";

export function makeObs(
  startTs: number,
  endTs: number,
  minVal: number,
  maxVal: number,
  count = 50,
): Observation[] {
  if (count <= 1) {
    return [{ timestamp: startTs, value: minVal }];
  }

  const step = (endTs - startTs) / (count - 1);
  const valStep = (maxVal - minVal) / (count - 1);
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTs + i * step,
    value: minVal + i * valStep,
  }));
}

export function makeChartConfig(now: number): ChartConfig {
  return {
    width: 800,
    height: 500,
    margin: { top: 20, right: 20, bottom: 40, left: 60 },
    metric: "multi",
    timeRange: [now - 3600, now],
    showDistribution: true,
    showEvents: false,
    liveMode: false,
    colors: {
      line: "#E67E22",
      distribution: "#E67E2233",
      event: "#999",
      eventHover: "#7EC7FF",
    },
  };
}

export function getMetricState(chart: ChartView, name: string): any {
  return (chart as any)._getMetricStateForTest(name);
}
