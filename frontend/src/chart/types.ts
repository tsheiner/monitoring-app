/**
 * Type definitions for the chart system.
 */

// ============================================================================
// Status Zone Colors (shared by ribbon and tooltip gauges)
// ============================================================================

export const STATUS_ZONE_COLORS = {
  green: "#27AE60",      // Inner band (p25-p75), healthy zone
  yellow: "#F0C243",     // Middle band (p10-p90), warning zone
  orangeRed: "#E74C3C",  // Outer band (p5-p95), critical zone
} as const;

// ============================================================================
// Data Types
// ============================================================================

export interface ClassifierValue {
  value: number;
  status: "green" | "yellow" | "red";
}

export interface Observation {
  timestamp: number;
  value: number;
  classifiers?: Record<string, ClassifierValue>;
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

export interface HourlyDistribution {
  hour: number;
  distribution: Distribution;
  fallback_source: string;
  sample_count: number;
}

export interface BaselineResponse {
  metric: string;
  entity: string | null;
  lookback_days: number;
  timezone: string;
  hourly_distributions: HourlyDistribution[];
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
  classifiers?: Record<string, ClassifierValue>;
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
