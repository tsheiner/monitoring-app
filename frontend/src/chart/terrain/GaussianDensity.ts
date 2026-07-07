import { DensityModel, GaussianParams } from "./types";

const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

function validSigma(sigma: number): number {
  return Number.isFinite(sigma) && sigma > 0 ? sigma : Number.EPSILON;
}

export const gaussianDensity: DensityModel<GaussianParams> = {
  pdf(value, params) {
    const sigma = validSigma(params.sigma);
    const standardized = (value - params.mu) / sigma;
    return Math.exp(-0.5 * standardized * standardized) / (sigma * SQRT_TWO_PI);
  },

  dpdfDy(value, params) {
    const sigma = validSigma(params.sigma);
    const density = gaussianDensity.pdf(value, { ...params, sigma });
    return (-density * (value - params.mu)) / (sigma * sigma);
  },
};
