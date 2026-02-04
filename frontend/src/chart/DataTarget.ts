/**
 * DataTarget - Manages data buffer for a series.
 * 
 * Handles:
 * - Buffering observations
 * - Y-domain tracking (min/max)
 * - Filtering by time range
 */

import { Observation } from './types';

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
    observations.forEach(obs => {
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
      obs => obs.timestamp >= start && obs.timestamp <= end
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
}
