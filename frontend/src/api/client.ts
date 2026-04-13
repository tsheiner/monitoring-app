/**
 * API Client - Handles HTTP and WebSocket communication with backend.
 */

import {
  MetricResponse,
  EventsResponse,
  BaselineResponse,
  WebSocketMessage,
  MetricMessage,
  EventMessage,
} from "../chart/types";

const HTTP_PORT = import.meta.env.VITE_HTTP_PORT || "5030";
const WS_PORT = import.meta.env.VITE_WS_PORT || "5031";
const HOST = window.location.hostname;
const HTTP_BASE_URL = `http://${HOST}:${HTTP_PORT}`;
const WS_URL = `ws://${HOST}:${WS_PORT}`;

export class APIClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts: number = 0;
  private shouldReconnect: boolean = true;
  private onMetricCallback: ((message: MetricMessage) => void) | null = null;
  private onEventCallback: ((message: EventMessage) => void) | null = null;
  private onConnectedCallback: (() => void) | null = null;
  private onDisconnectedCallback: (() => void) | null = null;
  private disconnectTime: number | null = null; // Track when we disconnected
  private onReconnectCallback: ((gapDuration: number) => void) | null = null;

  private async fetchJson<T>(
    url: string,
    timeoutMs: number = 10000,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) {
      return;
    }

    const delayMs = Math.min(3000, 250 * 2 ** this.reconnectAttempts);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts += 1;
      this.connectWebSocket();
    }, delayMs);
  }

  /**
   * Fetch historical metric data.
   */
  async fetchMetricHistory(
    metric: string,
    start: number,
    end: number,
  ): Promise<MetricResponse> {
    // Round timestamps to integers (backend expects int, not float)
    const startInt = Math.floor(start);
    const endInt = Math.ceil(end);

    const url = `${HTTP_BASE_URL}/api/metrics/${metric}?start=${startInt}&end=${endInt}&entity=_aggregated`;
    return this.fetchJson<MetricResponse>(url, 12000);
  }

  /**
   * Fetch historical events.
   */
  async fetchEvents(
    start: number,
    end: number,
    eventType?: string,
  ): Promise<EventsResponse> {
    // Round timestamps to integers (backend expects int, not float)
    const startInt = Math.floor(start);
    const endInt = Math.ceil(end);

    let url = `${HTTP_BASE_URL}/api/events?start=${startInt}&end=${endInt}`;
    if (eventType) {
      url += `&event_type=${eventType}`;
    }

    return this.fetchJson<EventsResponse>(url, 10000);
  }

  /**   * Fetch baseline distribution for a metric.
   */
  async fetchBaseline(
    metric: string,
    entity: string | null = null,
    lookbackDays: number = 30,
  ): Promise<BaselineResponse> {
    let url = `${HTTP_BASE_URL}/api/metrics/${metric}/baseline?lookback_days=${lookbackDays}`;
    if (entity) {
      url += `&entity=${entity}`;
    }

    return this.fetchJson<BaselineResponse>(url, 8000);
  }

  /**
   * Fetch baseline distribution for a classifier.
   */
  async fetchClassifierBaseline(classifier: string): Promise<BaselineResponse> {
    const url = `${HTTP_BASE_URL}/api/classifiers/${classifier}/baseline`;
    return this.fetchJson<BaselineResponse>(url, 8000);
  }

  /**   * Connect to WebSocket stream.
   */
  connectWebSocket(): void {
    if (this.ws) {
      return;
    }

    this.shouldReconnect = true;

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log("WebSocket connected");
      this.reconnectAttempts = 0;

      // Check if we reconnected after a disconnection
      if (this.disconnectTime && this.onReconnectCallback) {
        const now = Math.floor(Date.now() / 1000);
        const gapDuration = now - this.disconnectTime;
        console.log(`Reconnected after ${gapDuration} seconds of downtime`);
        this.onReconnectCallback(gapDuration);
      }

      this.disconnectTime = null;

      if (this.onConnectedCallback) {
        this.onConnectedCallback();
      }
    };

    this.ws.onmessage = (event) => {
      const message: WebSocketMessage = JSON.parse(event.data);

      if (message.type === "metric" && this.onMetricCallback) {
        this.onMetricCallback(message as MetricMessage);
      } else if (message.type === "event" && this.onEventCallback) {
        this.onEventCallback(message as EventMessage);
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.ws.onclose = () => {
      console.log("WebSocket disconnected");
      this.disconnectTime = Math.floor(Date.now() / 1000);
      this.ws = null;
      if (this.onDisconnectedCallback) {
        this.onDisconnectedCallback();
      }

      this.scheduleReconnect();
    };
  }

  /**
   * Disconnect WebSocket.
   */
  disconnectWebSocket(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Register callback for metric messages.
   */
  onMetric(callback: (message: MetricMessage) => void): void {
    this.onMetricCallback = callback;
  }

  /**
   * Register callback for event messages.
   */
  onEvent(callback: (message: EventMessage) => void): void {
    this.onEventCallback = callback;
  }

  /**
   * Register callback for connection status.
   */
  onConnected(callback: () => void): void {
    this.onConnectedCallback = callback;
  }

  /**
   * Register callback for disconnection.
   */
  onDisconnected(callback: () => void): void {
    this.onDisconnectedCallback = callback;
  }

  /**
   * Register callback for reconnection with gap duration.
   */
  onReconnect(callback: (gapDuration: number) => void): void {
    this.onReconnectCallback = callback;
  }

  /**
   * Check if WebSocket is connected.
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
