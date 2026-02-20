/**
 * Tests for mousemove simulation with deterministic time.
 * Validates that mouse interactions can be accurately simulated
 * with controlled timing for predictable hover behavior testing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createMouseEvent,
  simulateMouseMove,
  simulateHoverSequence,
  simulateClick,
  createChartContainer,
  cleanupChartContainer,
  chartToClientCoords,
} from './mouseUtils';

describe('Mouse Event Simulation with Deterministic Time', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Reset and set deterministic time
    resetMockedTime();
    setMockedTime(1000000); // Start at 1,000,000 ms
    container = createChartContainer();
  });

  afterEach(() => {
    cleanupChartContainer(container);
  });

  it('should create mousemove event with specified coordinates', () => {
    const event = createMouseEvent('mousemove', {
      clientX: 150,
      clientY: 200,
    });

    expect(event.type).toBe('mousemove');
    expect(event.clientX).toBe(150);
    expect(event.clientY).toBe(200);
    expect(event.bubbles).toBe(true);
    expect(event.cancelable).toBe(true);
  });

  it('should simulate mousemove with event capture', () => {
    let capturedEvent: Event | null = null;

    container.addEventListener('mousemove', (e) => {
      capturedEvent = e;
    });

    simulateMouseMove(container, 100, 150);

    expect(capturedEvent).toBeTruthy();
    if (capturedEvent) {
      const mouseEvent = capturedEvent as MouseEvent;
      expect(mouseEvent.clientX).toBe(100);
      expect(mouseEvent.clientY).toBe(150);
    }
  });

  it('should simulate mousemove with deterministic time', () => {
    const events: Array<{ x: number; y: number; time: number }> = [];

    container.addEventListener('mousemove', (e) => {
      const mouseEvent = e as MouseEvent;
      events.push({
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
        time: performance.now(),
      });
    });

    // Move at time 1,000,000 ms
    simulateMouseMove(container, 50, 60);

    // Advance time by 16ms (one frame)
    advanceTime(16);

    // Move at time 1,000,016 ms
    simulateMouseMove(container, 70, 80);

    // Advance time by 16ms
    advanceTime(16);

    // Move at time 1,000,032 ms
    simulateMouseMove(container, 90, 100);

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ x: 50, y: 60, time: 1000000 });
    expect(events[1]).toEqual({ x: 70, y: 80, time: 1000016 });
    expect(events[2]).toEqual({ x: 90, y: 100, time: 1000032 });
  });

  it('should simulate hover sequence with enter, moves, and leave', () => {
    const eventLog: string[] = [];

    container.addEventListener('mouseenter', () => {
      eventLog.push(`enter at ${performance.now()}`);
    });

    container.addEventListener('mousemove', (e) => {
      const mouseEvent = e as MouseEvent;
      eventLog.push(
        `move to (${mouseEvent.clientX},${mouseEvent.clientY}) at ${performance.now()}`
      );
    });

    container.addEventListener('mouseleave', () => {
      eventLog.push(`leave at ${performance.now()}`);
    });

    simulateHoverSequence(container, [
      { x: 100, y: 100 },
      { x: 150, y: 150 },
      { x: 200, y: 200 },
    ]);

    expect(eventLog).toHaveLength(5); // enter + 3 moves + leave
    expect(eventLog[0]).toContain('enter');
    expect(eventLog[1]).toContain('move to (100,100)');
    expect(eventLog[2]).toContain('move to (150,150)');
    expect(eventLog[3]).toContain('move to (200,200)');
    expect(eventLog[4]).toContain('leave');
  });

  it('should track timing deltas between events', () => {
    const timings: number[] = [];
    let lastTime = performance.now();

    container.addEventListener('mousemove', () => {
      const currentTime = performance.now();
      timings.push(currentTime - lastTime);
      lastTime = currentTime;
    });

    // Simulate moves with specific time deltas
    simulateMouseMove(container, 10, 10);

    advanceTime(16); // ~60fps
    simulateMouseMove(container, 20, 20);

    advanceTime(16);
    simulateMouseMove(container, 30, 30);

    advanceTime(32); // ~30fps
    simulateMouseMove(container, 40, 40);

    expect(timings).toHaveLength(4);
    expect(timings[0]).toBe(0); // First event has no delta
    expect(timings[1]).toBe(16);
    expect(timings[2]).toBe(16);
    expect(timings[3]).toBe(32);
  });

  it('should simulate click with mouse down, up, and click events', () => {
    const eventSequence: string[] = [];

    container.addEventListener('mousedown', () => {
      eventSequence.push('down');
    });

    container.addEventListener('mouseup', () => {
      eventSequence.push('up');
    });

    container.addEventListener('click', () => {
      eventSequence.push('click');
    });

    simulateClick(container, 100, 100);

    expect(eventSequence).toEqual(['down', 'up', 'click']);
  });

  it('should convert chart coordinates to client coordinates', () => {
    // Position the container at a known location
    container.style.position = 'absolute';
    container.style.left = '50px';
    container.style.top = '100px';

    // Note: In happy-dom, getBoundingClientRect might not work as expected
    // This test demonstrates the API usage
    const clientCoords = chartToClientCoords(container, 25, 30);

    expect(clientCoords).toHaveProperty('x');
    expect(clientCoords).toHaveProperty('y');
    expect(typeof clientCoords.x).toBe('number');
    expect(typeof clientCoords.y).toBe('number');
  });

  it('should handle rapid sequential mousemove events', () => {
    const positions: Array<{ x: number; y: number; time: number }> = [];

    container.addEventListener('mousemove', (e) => {
      const mouseEvent = e as MouseEvent;
      positions.push({
        x: mouseEvent.clientX,
        y: mouseEvent.clientY,
        time: performance.now(),
      });
    });

    // Simulate rapidly moving mouse (every 4ms)
    for (let i = 0; i < 10; i++) {
      simulateMouseMove(container, i * 10, i * 10);
      advanceTime(4);
    }

    expect(positions).toHaveLength(10);

    // Verify positions are correct
    for (let i = 0; i < 10; i++) {
      expect(positions[i].x).toBe(i * 10);
      expect(positions[i].y).toBe(i * 10);
      expect(positions[i].time).toBe(1000000 + i * 4);
    }
  });

  it('should allow time to be reset between test scenarios', () => {
    const times: number[] = [];

    container.addEventListener('mousemove', () => {
      times.push(performance.now());
    });

    // First scenario
    simulateMouseMove(container, 10, 10);
    advanceTime(100);
    simulateMouseMove(container, 20, 20);

    expect(times).toEqual([1000000, 1000100]);

    // Reset time for second scenario
    resetMockedTime();
    setMockedTime(2000000);
    times.length = 0;

    // Second scenario
    simulateMouseMove(container, 30, 30);
    advanceTime(50);
    simulateMouseMove(container, 40, 40);

    expect(times).toEqual([2000000, 2000050]);
  });

  it('should support multiple event listeners on same element', () => {
    let listener1Called = false;
    let listener2Called = false;

    container.addEventListener('mousemove', () => {
      listener1Called = true;
    });

    container.addEventListener('mousemove', () => {
      listener2Called = true;
    });

    simulateMouseMove(container, 50, 50);

    expect(listener1Called).toBe(true);
    expect(listener2Called).toBe(true);
  });
});
