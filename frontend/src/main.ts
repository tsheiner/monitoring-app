/**
 * Main Application - Wires chart, API client, and UI together.
 */

import "./style.css";
import { ChartView } from "./chart/ChartView";
import { APIClient } from "./api/client";
import { ChartConfig, Event } from "./chart/types";

class MonitoringApp {
  private chart: ChartView;
  private api: APIClient;
  private currentMetric: string = "time_to_connect";
  private currentTimeRangeSeconds: number = 86400; // Start with 24 hours to catch historical data
  private events: Event[] = [];

  // Per-metric color scheme
  private metricColors: Record<string, { line: string; distribution: string }> =
    {
      time_to_connect: { line: "#E67E22", distribution: "#E67E22" }, // Orange
      throughput: { line: "#3498DB", distribution: "#3498DB" }, // Blue
      coverage: { line: "#2ECC71", distribution: "#2ECC71" }, // Green
      capacity: { line: "#9B59B6", distribution: "#9B59B6" }, // Purple
      roaming: { line: "#E74C3C", distribution: "#E74C3C" }, // Red
      successful_connects: { line: "#1ABC9C", distribution: "#1ABC9C" }, // Teal
      ap_health: { line: "#F39C12", distribution: "#F39C12" }, // Amber
    };

  constructor() {
    // Initialize API client
    this.api = new APIClient();

    // Create chart configuration
    // For initial load, request last 24 hours to ensure we get historical data
    // (backend may have been bootstrapped days ago)
    const now = Math.floor(Date.now() / 1000);
    const initialTimeRange = this.currentTimeRangeSeconds; // 24 hours
    const metricColor = this.metricColors[this.currentMetric] || {
      line: "#D87118",
      distribution: "#4E8DB8",
    };
    const config: ChartConfig = {
      width: 1200,
      height: 500,
      margin: { top: 20, right: 50, bottom: 50, left: 70 },
      metric: this.currentMetric,
      timeRange: [now - initialTimeRange, now], // [past, NOW]
      showDistribution: true,
      showEvents: true,
      liveMode: true,
      colors: {
        line: metricColor.line,
        distribution: metricColor.distribution,
        event: "#999",
        eventHover: "#7EC7FF",
      },
    };

    // Initialize chart
    const container = document.getElementById("chart");
    if (!container) throw new Error("Chart container not found");

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
    window.addEventListener("resize", () => this.handleResize());
  }

  private getTimeRange(): [number, number] {
    // Use current time as end, regardless of when historical data was generated
    const now = Math.floor(Date.now() / 1000);
    return [now - this.currentTimeRangeSeconds, now];
  }

  private async loadData(): Promise<void> {
    const [start, end] = this.getTimeRange();

    try {
      // Load metric history
      console.log(
        `Fetching metric data: ${this.currentMetric} from ${new Date(start * 1000).toISOString()} to ${new Date(end * 1000).toISOString()}`,
      );
      const metricData = await this.api.fetchMetricHistory(
        this.currentMetric,
        start,
        end,
      );
      console.log(`Received ${metricData.observations.length} observations`);

      // Update chart config with CURRENT time range
      this.chart.setTimeRange(this.currentTimeRangeSeconds);

      this.chart.loadHistoricalData(
        metricData.observations,
        metricData.distribution,
        metricData.distribution_series,
      );

      // Load events
      const eventsData = await this.api.fetchEvents(start, end);
      this.events = eventsData.events;
      this.chart.updateEvents(this.events);

      this.updateStats(metricData.observations.length, this.events.length);
    } catch (error) {
      console.error("Error loading data:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.showError(`Failed to load historical data: ${errorMessage}`);

      // Show empty chart with error state
      this.chart.loadHistoricalData([], null);
      this.updateStats(0, 0);
    }
  }

  private setupControls(): void {
    // Metric selector
    const metricSelect = document.getElementById(
      "metric-select",
    ) as HTMLSelectElement;
    metricSelect.addEventListener("change", async () => {
      this.currentMetric = metricSelect.value;

      // Update colors for new metric
      const metricColor = this.metricColors[this.currentMetric] || {
        line: "#D87118",
        distribution: "#4E8DB8",
      };
      this.chart.updateColors({
        line: metricColor.line,
        distribution: metricColor.distribution,
      });

      await this.loadData();
    });

    // Time range selector
    const timeRangeSelect = document.getElementById(
      "time-range",
    ) as HTMLSelectElement;
    timeRangeSelect.addEventListener("change", async () => {
      this.currentTimeRangeSeconds = parseInt(timeRangeSelect.value);
      // Clear existing data and reload with new range
      await this.loadData();
    });

    // Live mode toggle
    const liveModeCheckbox = document.getElementById(
      "live-mode",
    ) as HTMLInputElement;
    liveModeCheckbox.addEventListener("change", () => {
      this.chart.setLiveMode(liveModeCheckbox.checked);
    });

    // Show distribution toggle
    const showDistributionCheckbox = document.getElementById(
      "show-distribution",
    ) as HTMLInputElement;
    showDistributionCheckbox.addEventListener("change", () => {
      this.chart.setShowDistribution(showDistributionCheckbox.checked);
    });

    // Show events toggle
    const showEventsCheckbox = document.getElementById(
      "show-events",
    ) as HTMLInputElement;
    showEventsCheckbox.addEventListener("change", () => {
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
          value: message.value,
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
        metadata: message.metadata,
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

    // Handle reconnection with data gap recovery
    this.api.onReconnect(async (gapDuration) => {
      console.log(
        `Reconnected after ${gapDuration}s gap, reloading recent data...`,
      );
      // Reload last hour of data to fill gap
      const now = Math.floor(Date.now() / 1000);
      const gapStart = now - Math.min(gapDuration + 60, 3600); // At most 1 hour

      try {
        const gapData = await this.api.fetchMetricHistory(
          this.currentMetric,
          gapStart,
          now,
        );
        console.log(
          `Recovered ${gapData.observations.length} observations from gap`,
        );
        // Note: Observations will be deduplicated by timestamp in DataTarget
      } catch (error) {
        console.error("Failed to recover gap data:", error);
      }
    });
  }

  private updateConnectionStatus(connected: boolean): void {
    const statusElement = document.getElementById("connection-status");
    if (!statusElement) return;

    if (connected) {
      statusElement.textContent = "Connected";
      statusElement.className = "status-connected";
    } else {
      statusElement.textContent = "Disconnected";
      statusElement.className = "status-disconnected";
    }
  }

  private updateStats(observations: number, events: number): void {
    const statsElement = document.getElementById("data-stats");
    if (!statsElement) return;

    statsElement.textContent = `${observations} observations | ${events} events`;
  }

  private showError(message: string): void {
    console.error(message);
    const statsElement = document.getElementById("data-stats");
    if (statsElement) {
      statsElement.textContent = `⚠️ ${message}`;
      statsElement.style.color = "#ff6b6b";
    }
  }

  private handleResize(): void {
    const container = document.getElementById("chart");
    if (!container) return;

    const width = container.clientWidth;
    const height = 500; // Fixed height for prototype

    this.chart.resize(width, height);
  }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new MonitoringApp();
});
