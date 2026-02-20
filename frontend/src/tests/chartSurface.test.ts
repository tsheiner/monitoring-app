/**
 * Tests for chart surface mounting and basic rendering.
 * Ensures the chart can be instantiated in a test environment
 * and is ready for hover interaction testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChartView } from '../chart/ChartView';
import { ChartConfig } from '../chart/types';
import {
  createChartContainer,
  cleanupChartContainer,
} from './mouseUtils';

describe('Chart Surface Mounting', () => {
  let container: HTMLDivElement;
  let config: ChartConfig;

  beforeEach(() => {
    // Reset mocked time before each test
    resetMockedTime();
    setMockedTime(Date.now());

    // Create a container for the chart
    container = createChartContainer();

    // Create a basic chart config
    const now = Math.floor(Date.now() / 1000);
    config = {
      width: 800,
      height: 400,
      margin: { top: 20, right: 20, bottom: 40, left: 60 },
      metric: 'throughput',
      timeRange: [now - 3600, now], // Last hour
      showDistribution: true,
      showEvents: false,
      liveMode: false,
      colors: {
        line: '#4CAF50',
        distribution: '#4CAF5033',
        event: '#ff6b6b',
        eventHover: '#ff8787',
      },
    };
  });

  afterEach(() => {
    // Clean up the container
    cleanupChartContainer(container);
  });

  it('should mount chart surface in test environment', () => {
    // Create a chart instance
    new ChartView(container, config);

    // Verify the SVG was created
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('800');
    expect(svg?.getAttribute('height')).toBe('400');
  });

  it('should create chart group with proper transform', () => {
    new ChartView(container, config);

    const chartGroup = container.querySelector('.chart-group');
    expect(chartGroup).toBeTruthy();

    const transform = chartGroup?.getAttribute('transform');
    expect(transform).toContain('translate(60,20)'); // margin.left, margin.top
  });

  it('should create clipped content group for chart elements', () => {
    new ChartView(container, config);

    // Verify clip-path definition exists
    const clipPath = container.querySelector('clipPath#chart-clip');
    expect(clipPath).toBeTruthy();

    // Verify content group uses clip-path
    const contentGroup = container.querySelector('.content-group');
    expect(contentGroup).toBeTruthy();
    expect(contentGroup?.getAttribute('clip-path')).toBe('url(#chart-clip)');
  });

  it('should create x and y axes', () => {
    new ChartView(container, config);

    const xAxis = container.querySelector('.x-axis');
    const yAxis = container.querySelector('.y-axis');

    expect(xAxis).toBeTruthy();
    expect(yAxis).toBeTruthy();
  });

  it('should position x-axis at bottom of chart area', () => {
    new ChartView(container, config);

    const xAxis = container.querySelector('.x-axis');
    const chartHeight =
      config.height - config.margin.top - config.margin.bottom;

    const transform = xAxis?.getAttribute('transform');
    expect(transform).toContain(`translate(0,${chartHeight})`);
  });

  it('should create SVG suitable for mouse event handling', () => {
    new ChartView(container, config);

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();

    // SVG should be an instance that can receive events
    expect(svg instanceof SVGSVGElement).toBe(true);

    // Verify we can attach event listeners without errors
    let eventReceived = false;
    svg?.addEventListener('mousemove', () => {
      eventReceived = true;
    });

    // Dispatch a test event
    const event = new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
    });
    svg?.dispatchEvent(event);

    expect(eventReceived).toBe(true);
  });

  it('should support adding metrics after mount', () => {
    const chart = new ChartView(container, config);

    // Add a metric
    chart.addMetric('throughput', '#4CAF50');

    // Chart should still be valid
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('should create chart with deterministic dimensions', () => {
    new ChartView(container, config);

    const svg = container.querySelector('svg');
    const width = parseInt(svg?.getAttribute('width') || '0');
    const height = parseInt(svg?.getAttribute('height') || '0');

    expect(width).toBe(config.width);
    expect(height).toBe(config.height);

    // Verify chart area dimensions
    const chartWidth = config.width - config.margin.left - config.margin.right;
    const chartHeight = config.height - config.margin.top - config.margin.bottom;

    expect(chartWidth).toBe(720); // 800 - 60 - 20
    expect(chartHeight).toBe(340); // 400 - 20 - 40
  });
});
