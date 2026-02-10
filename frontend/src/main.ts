/**
 * Main Application - Wires chart, API client, and UI together.
 */

import "./style.css";
import { ChartView } from "./chart/ChartView";
import { APIClient } from "./api/client";
import { ChartConfig, Event } from "./chart/types";

// Metric configuration
interface MetricInfo {
  name: string;
  label: string;
  color: string;
  enabled: boolean;
}

// Event group configuration
interface EventGroup {
  name: string;
  label: string;
  eventTypes: string[];
  enabled: boolean;
  icon: string; // SVG path data
}

class MonitoringApp {
  private chart: ChartView;
  private api: APIClient;
  private currentTimeRangeSeconds: number = 3600; // Start with 1 hour
  private allEvents: Event[] = [];
  private loadedRange: [number, number] = [0, 0]; // Track the actual data range
  private dataFetchDebounceTimer: number | null = null;

  // Metric configuration
  private metrics: MetricInfo[] = [
    {
      name: "time_to_connect",
      label: "Time to Connect",
      color: "#E67E22",
      enabled: true,
    },
    {
      name: "throughput",
      label: "Throughput",
      color: "#3498DB",
      enabled: false,
    },
    { name: "coverage", label: "Coverage", color: "#2ECC71", enabled: false },
    { name: "capacity", label: "Capacity", color: "#9B59B6", enabled: false },
    { name: "roaming", label: "Roaming", color: "#E74C3C", enabled: false },
    {
      name: "successful_connects",
      label: "Successful Connects",
      color: "#1ABC9C",
      enabled: false,
    },
    { name: "ap_health", label: "AP Health", color: "#F39C12", enabled: false },
  ];

  // Event group configuration with icon mappings
  private eventGroups: EventGroup[] = [
    {
      name: "device_lifecycle",
      label: "Device Lifecycle",
      eventTypes: ["device_restart", "device_crash", "firmware_update"],
      enabled: false,
      icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z", // Wifi
    },
    {
      name: "config",
      label: "Config",
      eventTypes: ["config_change"],
      enabled: false,
      icon: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z", // Settings
    },
    {
      name: "agent",
      label: "Agent",
      eventTypes: ["ai_action"],
      enabled: false,
      icon: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z", // CheckCircle
    },
    {
      name: "security",
      label: "Security",
      eventTypes: ["security_incident"],
      enabled: false,
      icon: "M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1.06 13.54L7.4 12l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41-5.64 5.66z", // Shield
    },
  ];

  constructor() {
    // Initialize API client
    this.api = new APIClient();

    // Initialize chart - measure container for responsive sizing
    const container = document.getElementById("chart");
    if (!container) throw new Error("Chart container not found");

    // Use actual container dimensions instead of hardcoded values
    const containerWidth = container.clientWidth || 900;
    const containerHeight = container.clientHeight || 500;
    // Height needs to accommodate: chart area + top margin + bottom margin
    // Bottom margin needs: x-axis (30px) + range text (20px) + brush (20px) + brush axis (30px) = 100px
    const chartHeight = Math.max(500, containerHeight);

    const now = Math.floor(Date.now() / 1000);
    const initialTimeRange = this.currentTimeRangeSeconds;
    const config: ChartConfig = {
      width: containerWidth,
      height: chartHeight,
      // Margins: top/right/left for axes, bottom for x-axis labels and range text
      margin: { top: 20, right: 50, bottom: 40, left: 70 },
      metric: "multi", // Not used in multi-metric mode
      timeRange: [now - initialTimeRange, now],
      showDistribution: true,
      showEvents: true,
      liveMode: true,
      colors: {
        line: "#E67E22",
        distribution: "#E67E22",
        event: "#999",
        eventHover: "#7EC7FF",
      },
    };

    this.chart = new ChartView(container, config);

    // Add initial metric (time_to_connect)
    const initialMetric = this.metrics.find((m) => m.enabled);
    if (initialMetric) {
      this.chart.addMetric(initialMetric.name, initialMetric.color);
    }

    // Setup UI controls
    this.setupControls();

    // Setup API callbacks
    this.setupAPICallbacks();

    // Wire up data fetching when user pans/zooms to new range
    // Debounce to avoid firing dozens of requests during a pan gesture
    this.chart.onDataNeeded((range) => {
      // Clear any pending fetch
      if (this.dataFetchDebounceTimer !== null) {
        clearTimeout(this.dataFetchDebounceTimer);
      }

      // Schedule new fetch after 300ms of no pan/zoom activity
      this.dataFetchDebounceTimer = window.setTimeout(async () => {
        const [visibleStart, visibleEnd] = range;
        const duration = visibleEnd - visibleStart;
        
        // Add 100% padding on each side (3x total: 1 past + 1 visible + 1 future)
        // This means user can pan 1 full screen in either direction without fetch
        const paddingAmount = duration;
        const fetchStart = visibleStart - paddingAmount;
        const fetchEnd = visibleEnd + paddingAmount;
        
        console.log(
          `Fetching data with buffer: visible [${visibleStart}, ${visibleEnd}], fetching [${fetchStart}, ${fetchEnd}]`,
        );
        await this.loadDataForRangeIncremental(fetchStart, fetchEnd);
        this.dataFetchDebounceTimer = null;
      }, 300);
    });

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
    await this.loadDataForRange(start, end);
  }

  private async loadDataForRange(start: number, end: number): Promise<void> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:loadDataForRange:entry',message:'Loading data for range',data:{start,end,duration:end-start,startDate:new Date(start*1000).toISOString(),endDate:new Date(end*1000).toISOString(),isValidRange:start<end},timestamp:Date.now(),runId:'422-debug',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    
    try {
      const duration = end - start;
      const enabledMetrics = this.metrics.filter((m) => m.enabled);

      // 1. Fetch ALL data first. Old chart stays visible during the fetch,
      //    preventing the "flash" (blank frame between clear and load).
      const fetchedData: Array<{
        metric: (typeof this.metrics)[0];
        data: Awaited<ReturnType<typeof this.api.fetchMetricHistory>>;
      }> = [];

      for (const metric of enabledMetrics) {
        console.log(
          `Fetching ${metric.name} from ${new Date(start * 1000).toISOString()} to ${new Date(end * 1000).toISOString()}`,
        );
        const metricData = await this.api.fetchMetricHistory(
          metric.name,
          start,
          end,
        );
        console.log(
          `Received ${metricData.observations.length} observations for ${metric.name}`,
        );
        fetchedData.push({ metric, data: metricData });
      }

      // 2. Set chart range (clears old data) — synchronous, no repaint yet
      this.chart.setTimeRange(duration, end);

      // 3. Load fetched data — synchronous, same JS tick as step 2.
      //    Browser won't repaint between clear and load, so no flash.
      for (const { metric, data } of fetchedData) {
        this.chart.loadHistoricalData(
          metric.name,
          data.observations,
          data.distribution,
          data.distribution_series,
        );
      }

      // Track the actual range used for this data load
      this.loadedRange = [start, end];

      // Load events for the requested range
      const eventsData = await this.api.fetchEvents(start, end);
      this.allEvents = eventsData.events;
      this.updateEventDisplay();

      // Update stats
      const totalObs = fetchedData.reduce(
        (sum, { data }) => sum + data.observations.length,
        0,
      );
      this.updateStats(totalObs, this.allEvents.length);
    } catch (error) {
      // #region agent log
      const errorMsg = error instanceof Error ? error.message : String(error);
      fetch('http://127.0.0.1:7243/ingest/9c3a7771-a4c8-495b-839c-58d702259981',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:loadDataForRange:error',message:'Failed to load data',data:{start,end,duration:end-start,error:errorMsg},timestamp:Date.now(),runId:'422-debug',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
      
      console.error("Error loading data:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.showError(`Failed to load historical data: ${errorMessage}`);
    }
  }

  /**
   * Load data incrementally for pan/zoom - only fetches missing data, preserves buffer.
   * Used during pan/zoom interactions to provide smooth scrolling.
   */
  private async loadDataForRangeIncremental(start: number, end: number): Promise<void> {
    try {
      const enabledMetrics = this.metrics.filter((m) => m.enabled);

      // Fetch data for each enabled metric
      for (const metric of enabledMetrics) {
        console.log(
          `Incrementally fetching ${metric.name} from ${new Date(start * 1000).toISOString()} to ${new Date(end * 1000).toISOString()}`,
        );
        const metricData = await this.api.fetchMetricHistory(
          metric.name,
          start,
          end,
        );
        console.log(
          `Received ${metricData.observations.length} observations for ${metric.name}`,
        );
        
        // Load data incrementally (appends to buffer, doesn't clear)
        this.chart.loadHistoricalData(
          metric.name,
          metricData.observations,
          metricData.distribution,
          metricData.distribution_series,
        );
      }

      // Load events for the extended range
      const eventsData = await this.api.fetchEvents(start, end);
      // Merge with existing events, removing duplicates
      const existingIds = new Set(this.allEvents.map(e => `${e.timestamp}-${e.event_type}`));
      const newEvents = eventsData.events.filter(e => !existingIds.has(`${e.timestamp}-${e.event_type}`));
      this.allEvents = [...this.allEvents, ...newEvents];
      this.updateEventDisplay();

      console.log(`Incremental fetch complete: now have ${this.allEvents.length} total events`);
    } catch (error) {
      console.error("Error loading incremental data:", error);
      // Don't show error to user - this is background prefetch
    }
  }

  private updateEventDisplay(): void {
    // Filter events based on enabled event groups
    const enabledTypes = new Set<string>();
    for (const group of this.eventGroups) {
      if (group.enabled) {
        group.eventTypes.forEach((type) => enabledTypes.add(type));
      }
    }

    const filteredEvents = this.allEvents.filter((e) =>
      enabledTypes.has(e.event_type),
    );
    this.chart.updateEvents(filteredEvents);

    // Update event counts in button labels
    this.updateEventCounts();
  }

  private updateEventCounts(): void {
    // Use the actual loaded data range, not a recomputed getTimeRange().
    // getTimeRange() computes a fresh "now" which drifts from the range
    // used to fetch events, causing off-by-one boundary mismatches.
    const [start, end] = this.loadedRange;

    // Count events per group within loaded time range
    for (const group of this.eventGroups) {
      const count = this.allEvents.filter(
        (e) =>
          group.eventTypes.includes(e.event_type) &&
          e.timestamp >= start &&
          e.timestamp <= end,
      ).length;

      // Update label in UI
      const label = document.querySelector(
        `.event-toggle[data-group="${group.name}"] span`,
      );
      if (label) {
        label.textContent = `${group.label} ${count}`;
      }
    }
  }

  /**
   * Jump to "now" - sets time range to [now - duration, now] and enables live mode.
   * This is called by the "Jump to Now" button.
   */
  private async jumpToNow(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const start = now - this.currentTimeRangeSeconds;
    this.chart.setTimeRange(this.currentTimeRangeSeconds, now);
    this.chart.setLiveMode(true);

    // Update the live mode checkbox UI
    const liveModeCheckbox = document.getElementById(
      "live-mode",
    ) as HTMLInputElement;
    if (liveModeCheckbox) {
      liveModeCheckbox.checked = true;
    }

    // CRITICAL: Fetch data for the new range
    await this.loadDataForRange(start, now);
  }

  private setupControls(): void {
    // Build metric toggles
    const metricsList = document.getElementById("metrics-list");
    if (metricsList) {
      for (const metric of this.metrics) {
        const toggle = document.createElement("div");
        toggle.className = "metric-toggle";
        toggle.dataset.metric = metric.name;

        const indicator = document.createElement("div");
        indicator.className = `metric-indicator ${metric.enabled ? "active" : ""}`;
        indicator.style.borderColor = metric.color;
        if (metric.enabled) {
          indicator.style.backgroundColor = metric.color;
        }

        const label = document.createElement("span");
        label.textContent = metric.label;

        toggle.appendChild(indicator);
        toggle.appendChild(label);

        toggle.addEventListener("click", () => this.toggleMetric(metric.name));

        metricsList.appendChild(toggle);
      }
    }

    // Build event group toggles
    const eventsList = document.getElementById("events-list");
    if (eventsList) {
      for (const group of this.eventGroups) {
        const toggle = document.createElement("div");
        toggle.className = "event-toggle";
        toggle.dataset.group = group.name;

        // Create SVG icon instead of circle indicator
        const svg = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        svg.setAttribute("class", "event-icon");
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "#999");
        svg.setAttribute("stroke-width", "2");

        // Add active class to toggle div for background styling
        if (group.enabled) {
          toggle.classList.add("active");
        }

        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute("d", group.icon);
        svg.appendChild(path);

        const label = document.createElement("span");
        label.textContent = group.label;
        label.dataset.group = group.name;

        toggle.appendChild(svg);
        toggle.appendChild(label);

        toggle.addEventListener("click", () =>
          this.toggleEventGroup(group.name),
        );

        eventsList.appendChild(toggle);
      }
    }

    // Time range selector
    const timeRangeSelect = document.getElementById(
      "time-range",
    ) as HTMLSelectElement;
    timeRangeSelect.addEventListener("change", async () => {
      this.currentTimeRangeSeconds = parseInt(timeRangeSelect.value);
      await this.loadData();
    });

    // Live mode toggle
    const liveModeCheckbox = document.getElementById(
      "live-mode",
    ) as HTMLInputElement;
    liveModeCheckbox.addEventListener("change", () => {
      this.chart.setLiveMode(liveModeCheckbox.checked);
    });

    // Jump to Now button
    const jumpToNowButton = document.getElementById(
      "jump-to-now",
    ) as HTMLButtonElement;
    jumpToNowButton.addEventListener("click", () => {
      this.jumpToNow();
    });
  }

  private async toggleMetric(metricName: string): Promise<void> {
    const metric = this.metrics.find((m) => m.name === metricName);
    if (!metric) return;

    metric.enabled = !metric.enabled;

    // Update UI
    const toggle = document.querySelector(
      `.metric-toggle[data-metric="${metricName}"]`,
    );
    if (toggle) {
      const indicator = toggle.querySelector(".metric-indicator");
      if (indicator) {
        if (metric.enabled) {
          indicator.classList.add("active");
          (indicator as HTMLElement).style.backgroundColor = metric.color;
        } else {
          indicator.classList.remove("active");
          (indicator as HTMLElement).style.backgroundColor = "";
        }
      }
    }

    // Update chart
    if (metric.enabled) {
      this.chart.addMetric(metricName, metric.color);
      // Load data using the chart's current range (anchored to data),
      // not getTimeRange() which always uses "now" and may overshoot.
      const [rangeStart, rangeEnd] = this.chart.getTimeRange();
      const metricData = await this.api.fetchMetricHistory(
        metricName,
        rangeStart,
        rangeEnd,
      );
      this.chart.loadHistoricalData(
        metricName,
        metricData.observations,
        metricData.distribution,
        metricData.distribution_series,
      );
    } else {
      this.chart.removeMetric(metricName);
    }
  }

  private toggleEventGroup(groupName: string): void {
    const group = this.eventGroups.find((g) => g.name === groupName);
    if (!group) return;

    group.enabled = !group.enabled;

    // Update UI - toggle active class on button for background styling
    const toggle = document.querySelector(
      `.event-toggle[data-group="${groupName}"]`,
    );
    if (toggle) {
      if (group.enabled) {
        toggle.classList.add("active");
      } else {
        toggle.classList.remove("active");
      }
    }

    // Update event display
    this.updateEventDisplay();
  }
  private setupAPICallbacks(): void {
    // Handle incoming metric observations
    this.api.onMetric((message) => {
      // Check if this metric is enabled
      const metric = this.metrics.find(
        (m) => m.name === message.metric && m.enabled,
      );
      if (metric) {
        this.chart.appendLiveData(message.metric, {
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

      this.allEvents.push(event);
      this.updateEventDisplay();
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
      const now = Math.floor(Date.now() / 1000);
      const gapStart = now - Math.min(gapDuration + 60, 3600);

      try {
        for (const metric of this.metrics.filter((m) => m.enabled)) {
          const gapData = await this.api.fetchMetricHistory(
            metric.name,
            gapStart,
            now,
          );
          console.log(
            `Recovered ${gapData.observations.length} observations for ${metric.name}`,
          );
        }
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
    const height = Math.max(500, container.clientHeight); // Minimum 500px

    this.chart.resize(width, height);
  }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new MonitoringApp();
});
