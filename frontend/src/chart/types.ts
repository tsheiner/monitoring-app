/**
 * Type definitions for the chart system.
 */

// ============================================================================
// Data Types
// ============================================================================

export interface Observation {
  timestamp: number;
  value: number;
}

export interface Distribution {
  p1: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  mean: number;
  stddev: number;
}

export interface DistributionPoint {
  timestamp: number;
  distribution: Distribution;
}

export interface Event {
  timestamp: number;
  event_type: string;
  severity?: string | null;
  entity?: string | null;
  message: string;
  metadata?: Record<string, any> | null;
}

// ============================================================================
// Chart Configuration
// ============================================================================

export interface ChartConfig {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };

  // Data configuration
  metric: string;
  timeRange: [number, number]; // Unix timestamps

  // Features
  showDistribution: boolean;
  showEvents: boolean;
  liveMode: boolean;

  // Visual configuration
  colors: {
    line: string;
    distribution: string;
    event: string;
    eventHover: string;
  };
}

// ============================================================================
// Generator Interface
// ============================================================================

export interface Generator {
  /** Set scales for rendering */
  setScales(xScale: any, yScale: any): void;

  /** Update with new data */
  update(data: any, range: [number, number]): void;

  /** Redraw without new data */
  redraw(range: [number, number]): void;

  /** Show the generator */
  show(): void;

  /** Hide the generator */
  hide(): void;

  /** Resize the generator */
  resize(width: number, height: number): void;

  /** Cleanup resources */
  destroy(): void;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface MetricResponse {
  metric: string;
  start: number;
  end: number;
  observations: Observation[];
  distribution: Distribution | null;
  distribution_series?: DistributionPoint[];
}

export interface EventsResponse {
  start: number;
  end: number;
  events: Event[];
  count: number;
}

// ============================================================================
// WebSocket Message Types
// ============================================================================

export type WebSocketMessage = MetricMessage | EventMessage;

export interface MetricMessage {
  type: "metric";
  timestamp: number;
  metric: string;
  value: number;
}

export interface EventMessage {
  type: "event";
  timestamp: number;
  event_type: string;
  severity?: string | null;
  entity?: string | null;
  message: string;
  metadata?: Record<string, any> | null;
}
