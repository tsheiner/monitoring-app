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
    const sizeBefore = this.buffer.length;
    this.buffer.push(...observations);

    // Update Y domain
    observations.forEach((obs) => {
      if (obs.value < this.yMin) this.yMin = obs.value;
      if (obs.value > this.yMax) this.yMax = obs.value;
    });

    // Sort by timestamp
    this.buffer.sort((a, b) => a.timestamp - b.timestamp);

    // #region agent log
    const tsSet = new Set(this.buffer.map(o => o.timestamp));
    const dupCount = this.buffer.length - tsSet.size;
    if (dupCount > 0 || this.buffer.length > 2000) {
      const logPayload = JSON.stringify({sessionId:'a62cc6',location:'DataTarget.ts:push',message:'Buffer state after push',data:{addedCount:observations.length,sizeBefore,sizeAfter:this.buffer.length,uniqueTimestamps:tsSet.size,duplicateCount:dupCount,yMin:this.yMin,yMax:this.yMax},timestamp:Date.now(),runId:'transition-diag',hypothesisId:'BUG-X2'});
      fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a62cc6'},body:logPayload}).catch(()=>{});
    }
    // #endregion
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
