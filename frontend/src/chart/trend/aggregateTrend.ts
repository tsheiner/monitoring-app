import { BaselineResponse, Observation, TrendDisplay, TrendPoint } from "../types";

const CADENCE_SECONDS = [60, 120, 300, 600, 1800, 3600];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function baseCadenceForRange(durationSeconds: number): number {
  if (durationSeconds <= 3600) return 0;
  if (durationSeconds <= 3 * 3600) return 60;
  if (durationSeconds <= 6 * 3600) return 120;
  if (durationSeconds <= 12 * 3600) return 300;
  if (durationSeconds <= 24 * 3600) return 600;
  return 3600;
}

function roundCadenceUp(seconds: number): number {
  for (const cadence of CADENCE_SECONDS) {
    if (seconds <= cadence) return cadence;
  }
  return CADENCE_SECONDS[CADENCE_SECONDS.length - 1];
}

export function selectTrendBucketSeconds(
  range: [number, number],
  plotWidthPx: number,
): number {
  const duration = range[1] - range[0];
  const base = baseCadenceForRange(duration);
  if (base === 0) return 0;

  const targetPoints = Math.max(1, plotWidthPx / 4);
  const pixelCadence = roundCadenceUp(duration / targetPoints);
  return Math.max(base, pixelCadence);
}

function toRawTrendPoint(observation: Observation): TrendPoint {
  return {
    ...observation,
    trendKind: "raw",
    bucketStart: observation.timestamp,
    bucketEnd: observation.timestamp,
    sampleCount: 1,
    sourceStartTimestamp: observation.timestamp,
    sourceEndTimestamp: observation.timestamp,
    minValue: observation.value,
    maxValue: observation.value,
  };
}

function getHourlyDistribution(
  baseline: BaselineResponse | null,
  timestamp: number,
) {
  if (!baseline) return null;
  const hour = new Date(timestamp * 1000).getHours();
  return baseline.hourly_distributions.find((entry) => entry.hour === hour)
    ?.distribution ?? null;
}

function isOutsideFootprint(
  observation: Observation,
  baseline: BaselineResponse | null,
): boolean {
  const distribution = getHourlyDistribution(baseline, observation.timestamp);
  if (!distribution) return false;
  return (
    observation.value < distribution.p1 ||
    observation.value > distribution.p99
  );
}

function buildExcursionEpisodes(
  observations: Observation[],
  baseline: BaselineResponse | null,
  gapSeconds: number,
): TrendPoint[] {
  if (!baseline) return [];

  const outside = observations.filter((observation) =>
    isOutsideFootprint(observation, baseline),
  );
  if (outside.length === 0) return [];

  const episodes: Observation[][] = [];
  for (const observation of outside) {
    const current = episodes[episodes.length - 1];
    const previous = current?.[current.length - 1];
    if (!current || !previous || observation.timestamp - previous.timestamp > gapSeconds) {
      episodes.push([observation]);
    } else {
      current.push(observation);
    }
  }

  return episodes.map((episode) => {
    const values = episode.map((observation) => observation.value);
    const representative = episode.reduce((current, candidate) =>
      Math.abs(candidate.value) > Math.abs(current.value) ? candidate : current,
    );
    return {
      ...representative,
      trendKind: "raw",
      bucketStart: episode[0].timestamp,
      bucketEnd: episode[episode.length - 1].timestamp,
      sampleCount: episode.length,
      sourceStartTimestamp: episode[0].timestamp,
      sourceEndTimestamp: episode[episode.length - 1].timestamp,
      minValue: Math.min(...values),
      maxValue: Math.max(...values),
    };
  });
}

export function buildTrendDisplay(
  observations: Observation[],
  range: [number, number],
  plotWidthPx: number,
  baseline: BaselineResponse | null = null,
): TrendDisplay {
  const visible = observations.filter(
    (observation) =>
      observation.timestamp >= range[0] && observation.timestamp <= range[1],
  );
  const bucketSeconds = selectTrendBucketSeconds(range, plotWidthPx);
  const excursionGap = Math.max(bucketSeconds || 90, 90);
  const excursions = buildExcursionEpisodes(visible, baseline, excursionGap);

  if (bucketSeconds === 0) {
    return {
      mode: "raw",
      bucketSeconds,
      points: visible.map(toRawTrendPoint),
      excursions,
    };
  }

  const buckets = new Map<number, Observation[]>();
  for (const observation of visible) {
    const bucketIndex = Math.floor((observation.timestamp - range[0]) / bucketSeconds);
    const bucketStart = range[0] + bucketIndex * bucketSeconds;
    const bucket = buckets.get(bucketStart) ?? [];
    bucket.push(observation);
    buckets.set(bucketStart, bucket);
  }

  const points: TrendPoint[] = [];
  for (const [bucketStart, bucket] of Array.from(buckets.entries()).sort(
    ([a], [b]) => a - b,
  )) {
    if (bucket.length === 0) continue;
    const values = bucket.map((observation) => observation.value);
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    points.push({
      timestamp: bucketStart + bucketSeconds / 2,
      value: median(values),
      trendKind: "bucket",
      bucketStart,
      bucketEnd: bucketStart + bucketSeconds,
      sampleCount: bucket.length,
      sourceStartTimestamp: first.timestamp,
      sourceEndTimestamp: last.timestamp,
      minValue: Math.min(...values),
      maxValue: Math.max(...values),
      classifiers: last.classifiers,
    });
  }

  return {
    mode: "bucketed",
    bucketSeconds,
    points,
    excursions,
  };
}
