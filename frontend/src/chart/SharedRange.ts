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
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SharedRange.ts:setRange',message:'Setting new range',data:{oldRange:this.range,newRange:range,duration:range[1]-range[0],callbackCount:this.callbacks.size,stack:new Error().stack},timestamp:Date.now(),sessionId:'debug-session',runId:'live-resize-bug',hypothesisId:'H11'})}).catch(()=>{});
    // #endregion
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
    this.callbacks.forEach(callback => {
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
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SharedRange.ts:slide',message:'Sliding range for live mode',data:{oldStart:start,oldEnd:end,windowSize,durationSeconds,newStart,newEnd,stack:new Error().stack},timestamp:Date.now(),sessionId:'debug-session',runId:'live-resize-bug',hypothesisId:'H11'})}).catch(()=>{});
    // #endregion
    
    this.setRange([newStart, newEnd]);
  }
  
  /**
   * Expand range to include a new timestamp (for live data append).
   */
  expandTo(timestamp: number): void {
    const [start, end] = this.range;
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SharedRange.ts:expandTo',message:'Attempting to expand range',data:{timestamp,currentStart:start,currentEnd:end,willExpand:timestamp>end,stack:new Error().stack},timestamp:Date.now(),sessionId:'debug-session',runId:'live-resize-bug',hypothesisId:'H11'})}).catch(()=>{});
    // #endregion
    
    if (timestamp > end) {
      const windowSize = end - start;
      this.setRange([timestamp - windowSize, timestamp]);
    }
  }
}
