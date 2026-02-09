/**
 * API Client - Handles HTTP and WebSocket communication with backend.
 */

import {
  MetricResponse,
  EventsResponse,
  WebSocketMessage,
  MetricMessage,
  EventMessage,
} from "../chart/types";

const HTTP_BASE_URL = "http://localhost:8001";
const WS_URL = "ws://localhost:8000";

export class APIClient {
  private ws: WebSocket | null = null;
  private onMetricCallback: ((message: MetricMessage) => void) | null = null;
  private onEventCallback: ((message: EventMessage) => void) | null = null;
  private onConnectedCallback: (() => void) | null = null;
  private onDisconnectedCallback: (() => void) | null = null;
  private disconnectTime: number | null = null; // Track when we disconnected
  private onReconnectCallback: ((gapDuration: number) => void) | null = null;

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
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'APIClient.ts:fetchMetricHistory',message:'Fetching metric history',data:{metric,startRaw:start,endRaw:end,startInt,endInt,duration:endInt-startInt,startDate:new Date(startInt*1000).toISOString(),endDate:new Date(endInt*1000).toISOString()},timestamp:Date.now(),runId:'422-debug',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    
    const url = `${HTTP_BASE_URL}/api/metrics/${metric}?start=${startInt}&end=${endInt}`;
    const response = await fetch(url);

    if (!response.ok) {
      // #region agent log
      const errorText = await response.text();
      fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'APIClient.ts:fetchMetricHistory:error',message:'HTTP error from backend',data:{metric,start:startInt,end:endInt,status:response.status,statusText:response.statusText,errorBody:errorText.substring(0,200)},timestamp:Date.now(),runId:'422-debug',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
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

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Connect to WebSocket stream.
   */
  connectWebSocket(): void {
    if (this.ws) {
      console.warn("WebSocket already connected");
      return;
    }

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log("WebSocket connected");

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

      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        console.log("Attempting WebSocket reconnection...");
        this.connectWebSocket();
      }, 3000);
    };
  }

  /**
   * Disconnect WebSocket.
   */
  disconnectWebSocket(): void {
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
