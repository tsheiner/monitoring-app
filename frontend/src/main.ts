/**
 * Main Application - Wires chart, API client, and UI together.
 */

import './style.css';
import { ChartView } from './chart/ChartView';
import { APIClient } from './api/client';
import { ChartConfig, Event } from './chart/types';

class MonitoringApp {
  private chart: ChartView;
  private api: APIClient;
  private currentMetric: string = 'time_to_connect';
  private currentTimeRangeSeconds: number = 21600; // Default to 6 hours
  private events: Event[] = [];
  
  constructor() {
    // Initialize API client
    this.api = new APIClient();
    
    // Create chart configuration
    const now = Math.floor(Date.now() / 1000);
    const config: ChartConfig = {
      width: 1200,
      height: 500,
      margin: { top: 20, right: 50, bottom: 50, left: 70 },
      metric: this.currentMetric,
      timeRange: [now - this.currentTimeRangeSeconds, now], // [past, NOW]
      showDistribution: true,
      showEvents: true,
      liveMode: true,
      colors: {
        line: '#D87118',       // Orange from juttle-viz
        distribution: '#4E8DB8', // Blue from juttle-viz
        event: '#999',
        eventHover: '#7EC7FF'
      }
    };
    
    // Initialize chart
    const container = document.getElementById('chart');
    if (!container) throw new Error('Chart container not found');
    
    this.chart = new ChartView(container, config);
    
    // Setup UI controls
    this.setupControls();
    
    // Setup API callbacks
    this.setupAPICallbacks();
    
    // Load initial data
    this.loadData();
    
    // Connect WebSocket
    this.api.connectWebSocket();
    
    // Handle window resize
    window.addEventListener('resize', () => this.handleResize());
  }
  
  private getTimeRange(): [number, number] {
    const now = Math.floor(Date.now() / 1000);
    return [now - this.currentTimeRangeSeconds, now];
  }
  
  private async loadData(): Promise<void> {
    const [start, end] = this.getTimeRange();
    
    try {
      // Load metric history
      console.log(`Fetching metric data: ${this.currentMetric} from ${new Date(start * 1000).toISOString()} to ${new Date(end * 1000).toISOString()}`);
      const metricData = await this.api.fetchMetricHistory(this.currentMetric, start, end);
      console.log(`Received ${metricData.observations.length} observations`);
      
      // Update chart config with CURRENT time range
      this.chart.setTimeRange(this.currentTimeRangeSeconds);
      
      this.chart.loadHistoricalData(metricData.observations, metricData.distribution);
      
      // Load events
      const eventsData = await this.api.fetchEvents(start, end);
      this.events = eventsData.events;
      this.chart.updateEvents(this.events);
      
      this.updateStats(metricData.observations.length, this.events.length);
      
    } catch (error) {
      console.error('Error loading data:', error);
      this.showError('Failed to load historical data');
    }
  }
  
  private setupControls(): void {
    // Metric selector
    const metricSelect = document.getElementById('metric-select') as HTMLSelectElement;
    metricSelect.addEventListener('change', async () => {
      this.currentMetric = metricSelect.value;
      await this.loadData();
    });
    
    // Time range selector
    const timeRangeSelect = document.getElementById('time-range') as HTMLSelectElement;
    timeRangeSelect.addEventListener('change', async () => {
      this.currentTimeRangeSeconds = parseInt(timeRangeSelect.value);
      this.chart.setTimeRange(this.currentTimeRangeSeconds);
      await this.loadData();
    });
    
    // Live mode toggle
    const liveModeCheckbox = document.getElementById('live-mode') as HTMLInputElement;
    liveModeCheckbox.addEventListener('change', () => {
      this.chart.setLiveMode(liveModeCheckbox.checked);
    });
    
    // Show events toggle
    const showEventsCheckbox = document.getElementById('show-events') as HTMLInputElement;
    showEventsCheckbox.addEventListener('change', () => {
      this.chart.setShowEvents(showEventsCheckbox.checked);
    });
  }
  
  private setupAPICallbacks(): void {
    // Handle incoming metric observations
    this.api.onMetric((message) => {
      // Only process if it's the current metric
      if (message.metric === this.currentMetric) {
        this.chart.appendLiveData({
          timestamp: message.timestamp,
          value: message.value
        });
      }
    });
    
    // Handle incoming events
    this.api.onEvent((message) => {
      const event: Event = {
        timestamp: message.timestamp,
        event_type: message.event_type,
        severity: message.severity,
        entity: message.entity,
        message: message.message,
        metadata: message.metadata
      };
      
      this.events.push(event);
      this.chart.updateEvents(this.events);
    });
    
    // Handle connection status
    this.api.onConnected(() => {
      this.updateConnectionStatus(true);
    });
    
    this.api.onDisconnected(() => {
      this.updateConnectionStatus(false);
    });
  }
  
  private updateConnectionStatus(connected: boolean): void {
    const statusElement = document.getElementById('connection-status');
    if (!statusElement) return;
    
    if (connected) {
      statusElement.textContent = 'Connected';
      statusElement.className = 'status-connected';
    } else {
      statusElement.textContent = 'Disconnected';
      statusElement.className = 'status-disconnected';
    }
  }
  
  private updateStats(observations: number, events: number): void {
    const statsElement = document.getElementById('data-stats');
    if (!statsElement) return;
    
    statsElement.textContent = `${observations} observations | ${events} events`;
  }
  
  private showError(message: string): void {
    console.error(message);
    // Could show a toast or modal here
  }
  
  private handleResize(): void {
    const container = document.getElementById('chart');
    if (!container) return;
    
    const width = container.clientWidth;
    const height = 500; // Fixed height for prototype
    
    this.chart.resize(width, height);
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new MonitoringApp();
});
