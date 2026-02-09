/**
 * SharedRange - Manages time range shared across chart components.
 *
 * All series and generators subscribe to range changes to stay synchronized.
 */

type RangeChangeCallback = (range: [number, number]) => void;

export class SharedRange {
  private range: [number, number];
  private callbacks: Set<RangeChangeCallback> = new Set();

  constructor(initialRange: [number, number]) {
    this.range = initialRange;
  }

  /**
   * Get current time range.
   */
  getRange(): [number, number] {
    return [...this.range] as [number, number];
  }

  /**
   * Set new time range and notify subscribers.
   */
  setRange(range: [number, number]): void {
    this.range = range;
    this.notifyChange();
  }

  /**
   * Subscribe to range changes.
   */
  onChange(callback: RangeChangeCallback): () => void {
    this.callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callback);
    };
  }

  /**
   * Notify all subscribers of range change.
   */
  private notifyChange(): void {
    this.callbacks.forEach((callback) => {
      callback(this.range);
    });
  }

  /**
   * Slide the range forward by a duration (for live mode).
   */
  slide(durationSeconds: number): void {
    const [start, end] = this.range;
    const windowSize = end - start;
    const newEnd = end + durationSeconds;
    const newStart = newEnd - windowSize;

    this.setRange([newStart, newEnd]);
  }

  /**
   * Expand range to include a new timestamp (for live data append).
   */
  expandTo(timestamp: number): void {
    const [start, end] = this.range;

    if (timestamp > end) {
      const windowSize = end - start;
      this.setRange([timestamp - windowSize, timestamp]);
    }
  }
}
