import { BaselineResponse, Distribution } from "../types";
import { DistributionDescriptor, GaussianParams } from "./types";

const NORMAL_IQR_FACTOR = 1.349;

export function distributionToGaussianParams(
  distribution: Distribution,
  ySpan: number,
): GaussianParams {
  const mu = Number.isFinite(distribution.mean)
    ? distribution.mean
    : distribution.p50;

  let sigma = distribution.stddev;
  if (!Number.isFinite(sigma) || sigma <= 0) {
    sigma = (distribution.p75 - distribution.p25) / NORMAL_IQR_FACTOR;
  }
  if (!Number.isFinite(sigma) || sigma <= 0) {
    sigma = Math.max(Math.abs(ySpan) * 0.01, 1e-6);
  }

  return { mu, sigma };
}

export function interpolateGaussianParams(
  descriptors: DistributionDescriptor[],
  timestamp: number,
): GaussianParams | null {
  if (descriptors.length === 0) return null;
  if (timestamp <= descriptors[0].timestamp) return descriptors[0].params;
  const last = descriptors[descriptors.length - 1];
  if (timestamp >= last.timestamp) return last.params;

  let low = 0;
  let high = descriptors.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (descriptors[middle].timestamp <= timestamp) low = middle;
    else high = middle;
  }

  const left = descriptors[low];
  const right = descriptors[high];
  const width = right.timestamp - left.timestamp;
  const mix = width > 0 ? (timestamp - left.timestamp) / width : 0;

  return {
    mu: left.params.mu + (right.params.mu - left.params.mu) * mix,
    sigma: left.params.sigma + (right.params.sigma - left.params.sigma) * mix,
  };
}

export function medianReferenceSigma(
  descriptors: DistributionDescriptor[],
): number {
  const sigmas = descriptors
    .map((descriptor) => descriptor.params.sigma)
    .filter((sigma) => Number.isFinite(sigma) && sigma > 0)
    .sort((a, b) => a - b);
  if (sigmas.length === 0) return 1;
  const middle = Math.floor(sigmas.length / 2);
  return sigmas.length % 2 === 0
    ? (sigmas[middle - 1] + sigmas[middle]) / 2
    : sigmas[middle];
}

export function baselineToGaussianDescriptors(
  baseline: BaselineResponse,
  range: [number, number],
  ySpan: number,
): DistributionDescriptor[] {
  const duration = Math.max(1, range[1] - range[0]);
  const pointCount = Math.min(100, Math.max(24, Math.floor(duration / 600)));
  const step = duration / pointCount;
  const byHour = new Map(
    baseline.hourly_distributions.map((hourly) => [hourly.hour, hourly]),
  );
  const descriptors: DistributionDescriptor[] = [];

  for (let index = 0; index <= pointCount; index += 1) {
    const timestamp = range[0] + step * index;
    const date = new Date(timestamp * 1000);
    const hour = date.getHours();
    const nextHour = (hour + 1) % 24;
    const current = byHour.get(hour);
    const next = byHour.get(nextHour) ?? current;
    if (!current || !next) continue;

    const currentParams = distributionToGaussianParams(
      current.distribution,
      ySpan,
    );
    const nextParams = distributionToGaussianParams(next.distribution, ySpan);
    const minuteMix =
      (date.getMinutes() + date.getSeconds() / 60) / 60;

    descriptors.push({
      timestamp,
      params: {
        mu:
          currentParams.mu +
          (nextParams.mu - currentParams.mu) * minuteMix,
        sigma:
          currentParams.sigma +
          (nextParams.sigma - currentParams.sigma) * minuteMix,
      },
    });
  }

  return descriptors;
}
