/**
 * DataTarget - Manages data buffer for a series.
 *
 * Handles:
 * - Buffering observations
 * - Y-domain tracking (min/max)
 * - Filtering by time range
 */

import { Observation } from "./types";

export class DataTarget {
  private buffer: Observation[] = [];
  private yMin: number = Infinity;
  private yMax: number = -Infinity;

  /**
   * Add observations to buffer.
   */
  push(observations: Observation[]): void {
    this.buffer.push(...observations);

    // Update Y domain
    observations.forEach((obs) => {
      if (obs.value < this.yMin) this.yMin = obs.value;
      if (obs.value > this.yMax) this.yMax = obs.value;
    });

    // Sort by timestamp
    this.buffer.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get observations in time range.
   */
  getInRange(start: number, end: number): Observation[] {
    return this.buffer.filter(
      (obs) => obs.timestamp >= start && obs.timestamp <= end,
    );
  }

  /**
   * Get Y domain [min, max] for all data.
   */
  getYDomain(): [number, number] {
    return [this.yMin, this.yMax];
  }

  /**
   * Get all observations.
   */
  getAll(): Observation[] {
    return [...this.buffer];
  }

  /**
   * Clear all data.
   */
  clear(): void {
    this.buffer = [];
    this.yMin = Infinity;
    this.yMax = -Infinity;
  }

  /**
   * Get number of observations.
   */
  count(): number {
    return this.buffer.length;
  }

  /**
   * Prune observations outside the given time range.
   * Used in live mode to prevent unbounded growth.
   */
  pruneOutsideRange(start: number, end: number): void {
    const oldCount = this.buffer.length;
    this.buffer = this.buffer.filter(
      (obs) => obs.timestamp >= start && obs.timestamp <= end,
    );

    // Recalculate Y domain from remaining data
    if (this.buffer.length > 0) {
      this.yMin = Math.min(...this.buffer.map((obs) => obs.value));
      this.yMax = Math.max(...this.buffer.map((obs) => obs.value));
    } else {
      this.yMin = Infinity;
      this.yMax = -Infinity;
    }

    const prunedCount = oldCount - this.buffer.length;
    if (prunedCount > 0) {
      console.log(
        `Pruned ${prunedCount} old observations outside visible range`,
      );
    }
  }

  /**
   * Compute distribution for observations in time range.
   * Used for live updates when backend distribution_series is not available.
   */
  computeDistributionInRange(start: number, end: number): any {
    const data = this.getInRange(start, end);
    if (data.length < 2) return null;

    const values = data.map((d) => d.value).sort((a, b) => a - b);
    const percentile = (p: number) => {
      const index = (p / 100) * (values.length - 1);
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      const weight = index - lower;
      return values[lower] * (1 - weight) + values[upper] * weight;
    };

    return {
      p1: percentile(1),
      p5: percentile(5),
      p10: percentile(10),
      p25: percentile(25),
      p50: percentile(50),
      p75: percentile(75),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      stddev: 0, // Not needed for visualization
    };
  }
}
