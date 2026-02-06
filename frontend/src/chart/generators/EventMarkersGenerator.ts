/**
 * EventMarkers Generator - Renders tear drop event markers with icons on timeline.
 */

import * as d3 from "d3";
import { Generator, Event } from "../types";

// Icon mappings for event types
const EVENT_ICONS: Record<string, string> = {
  // Device Lifecycle events
  device_restart:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z", // Wifi/Power icon
  device_crash:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z", // AlertCircle icon
  firmware_update:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z", // CheckCircle icon

  // Config events
  config_change:
    "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z", // Settings icon

  // Agent events
  ai_action: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z", // CheckCircle icon

  // Security events
  security_incident:
    "M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm-1.06 13.54L7.4 12l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41-5.64 5.66z", // Shield icon
};

export class EventMarkersGenerator implements Generator {
  private group: d3.Selection<SVGGElement, unknown, null, undefined>;
  private xScale: any;
  private yScale: any;
  private data: Event[] = [];
  private height: number = 0;
  private color: string;
  private hoverColor: string;

  constructor(
    parent: d3.Selection<SVGGElement, unknown, null, undefined>,
    color: string = "#999",
    hoverColor: string = "#7EC7FF",
  ) {
    this.color = color;
    this.hoverColor = hoverColor;

    this.group = parent.append("g").attr("class", "event-markers");
  }

  setScales(xScale: any, yScale: any): void {
    this.xScale = xScale;
    this.yScale = yScale;

    // Store chart height from Y scale range
    const range = yScale.range();
    this.height = Math.abs(range[0] - range[1]);
  }

  update(data: Event[], range: [number, number]): void {
    this.data = data;
    this.redraw(range);
  }

  redraw(range: [number, number]): void {
    if (!this.xScale || !this.yScale) return;

    // Update height from current Y scale range
    const yRange = this.yScale.range();
    this.height = Math.abs(yRange[0] - yRange[1]);

    // Filter events to visible range
    const visibleEvents = this.data.filter(
      (e) => e.timestamp >= range[0] && e.timestamp <= range[1],
    );

    // Bind data to marker groups (each group contains tear drop + icon)
    const markerGroups = this.group
      .selectAll<SVGGElement, Event>("g.event-marker")
      .data(visibleEvents, (d) => `${d.timestamp}-${d.event_type}`);

    // Enter
    const enter = markerGroups
      .enter()
      .append("g")
      .attr("class", "event-marker")
      .style("cursor", "pointer");

    // Add tail line from circle to x-axis
    enter
      .append("line")
      .attr("class", "event-tail")
      .attr("stroke", this.color)
      .attr("stroke-width", 1)
      .attr("opacity", 0.6)
      .attr("x1", 0)
      .attr("y1", 16)
      .attr("x2", 0);

    // Add tear drop circle with slight point at bottom
    enter
      .append("path")
      .attr("class", "tear-drop")
      .attr("fill", "none")
      .attr("stroke", this.color)
      .attr("stroke-width", 1)
      .attr("opacity", 0.8)
      .attr("d", this.getTearDropPath());

    // Add icon to each new marker (centered in tear drop)
    enter
      .append("path")
      .attr("class", "event-icon")
      .attr("fill", this.color)
      .attr("transform", "translate(-8, -8) scale(0.67)");

    // Update positions for all markers (enter + update)
    const allMarkers = markerGroups.merge(enter);

    allMarkers.attr("transform", (d) => {
      const x = this.xScale(new Date(d.timestamp * 1000));
      return `translate(${x}, 0)`;
    });

    // Update icon paths based on event type
    allMarkers
      .select("path.event-icon")
      .attr(
        "d",
        (d) => EVENT_ICONS[d.event_type] || EVENT_ICONS["device_crash"],
      );

    // Update tail heights to reach x-axis
    allMarkers.select("line.event-tail").attr("y2", this.height);

    // Add hover behavior
    allMarkers
      .on("mouseenter", (event, d) => {
        const group = d3.select(event.currentTarget as SVGGElement);
        group
          .select("path.tear-drop")
          .attr("stroke", this.hoverColor)
          .attr("opacity", 1);
        group
          .select("line.event-tail")
          .attr("stroke", this.hoverColor)
          .attr("opacity", 1);

        // Show tooltip
        this.showTooltip(event, d);
      })
      .on("mouseleave", (event) => {
        const group = d3.select(event.currentTarget as SVGGElement);
        group
          .select("path.tear-drop")
          .attr("stroke", this.color)
          .attr("opacity", 0.8);
        group
          .select("line.event-tail")
          .attr("stroke", this.color)
          .attr("opacity", 0.6);

        this.hideTooltip();
      });

    // Exit
    markerGroups.exit().remove();
  }

  /**
   * Generate SVG path for tear drop shape.
   * Nearly circular with a slight point pulled down at the 6 o'clock position.
   */
  private getTearDropPath(): string {
    const radius = 12;
    const pointExtension = 3; // How far the bottom point extends

    // Create a circle with bottom point slightly extended
    // Start at top, go clockwise, with slight point at bottom
    const path = `
      M 0,-${radius}
      A ${radius},${radius} 0 0,1 ${radius},0
      Q ${radius},${pointExtension} 0,${radius + pointExtension}
      Q -${radius},${pointExtension} -${radius},0
      A ${radius},${radius} 0 0,1 0,-${radius}
      Z
    `;

    return path.trim().replace(/\s+/g, " ");
  }

  private showTooltip(event: MouseEvent, data: Event): void {
    // Simple tooltip (could be enhanced)
    const tooltip = d3
      .select("body")
      .append("div")
      .attr("class", "event-tooltip")
      .style("position", "absolute")
      .style("background", "#333")
      .style("color", "#fff")
      .style("padding", "8px")
      .style("border-radius", "4px")
      .style("font-size", "12px")
      .style("pointer-events", "none")
      .style("z-index", "1000")
      .html(
        `
        <strong>${data.event_type}</strong><br/>
        ${data.message}<br/>
        <em>${data.entity || ""}</em>
      `,
      )
      .style("left", `${event.pageX + 10}px`)
      .style("top", `${event.pageY - 10}px`);
  }

  private hideTooltip(): void {
    d3.selectAll(".event-tooltip").remove();
  }

  show(): void {
    this.group.style("display", null);
  }

  hide(): void {
    this.group.style("display", "none");
  }

  resize(width: number, height: number): void {
    this.height = height;
    this.redraw(this.xScale.domain().map((d: Date) => d.getTime() / 1000));
  }

  destroy(): void {
    this.group.remove();
  }
}
