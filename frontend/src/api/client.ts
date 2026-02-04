/**
 * API Client - Handles HTTP and WebSocket communication with backend.
 */

import { 
  MetricResponse, 
  EventsResponse, 
  WebSocketMessage,
  MetricMessage,
  EventMessage 
} from '../chart/types';

const HTTP_BASE_URL = 'http://localhost:8001';
const WS_URL = 'ws://localhost:8000';

export class APIClient {
  private ws: WebSocket | null = null;
  private onMetricCallback: ((message: MetricMessage) => void) | null = null;
  private onEventCallback: ((message: EventMessage) => void) | null = null;
  private onConnectedCallback: (() => void) | null = null;
  private onDisconnectedCallback: (() => void) | null = null;
  
  /**
   * Fetch historical metric data.
   */
  async fetchMetricHistory(
    metric: string,
    start: number,
    end: number
  ): Promise<MetricResponse> {
    const url = `${HTTP_BASE_URL}/api/metrics/${metric}?start=${start}&end=${end}`;
    const response = await fetch(url);
    
    if (!response.ok) {
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
    eventType?: string
  ): Promise<EventsResponse> {
    let url = `${HTTP_BASE_URL}/api/events?start=${start}&end=${end}`;
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
      console.warn('WebSocket already connected');
      return;
    }
    
    this.ws = new WebSocket(WS_URL);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      if (this.onConnectedCallback) {
        this.onConnectedCallback();
      }
    };
    
    this.ws.onmessage = (event) => {
      const message: WebSocketMessage = JSON.parse(event.data);
      
      if (message.type === 'metric' && this.onMetricCallback) {
        this.onMetricCallback(message as MetricMessage);
      } else if (message.type === 'event' && this.onEventCallback) {
        this.onEventCallback(message as EventMessage);
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.ws = null;
      if (this.onDisconnectedCallback) {
        this.onDisconnectedCallback();
      }
      
      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        console.log('Attempting WebSocket reconnection...');
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
   * Check if WebSocket is connected.
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
