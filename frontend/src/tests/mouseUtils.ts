/**
 * Test utilities for simulating mouse and hover interactions
 * with deterministic time for chart testing.
 */

export interface MouseEventOptions {
  clientX?: number;
  clientY?: number;
  bubbles?: boolean;
  cancelable?: boolean;
  buttons?: number;
}

/**
 * Create a mouse event with specified options
 */
export function createMouseEvent(
  type: 'mousemove' | 'mouseenter' | 'mouseleave' | 'click' | 'mousedown' | 'mouseup',
  options: MouseEventOptions = {}
): MouseEvent {
  const {
    clientX = 0,
    clientY = 0,
    bubbles = true,
    cancelable = true,
    buttons = 0,
  } = options;

  const event = new MouseEvent(type, {
    bubbles,
    cancelable,
    clientX,
    clientY,
    buttons,
    view: window,
  });

  return event;
}

/**
 * Simulate a mousemove event on a target element
 */
export function simulateMouseMove(
  target: Element,
  x: number,
  y: number
): void {
  const event = createMouseEvent('mousemove', {
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(event);
}

/**
 * Simulate a mouse hover sequence (enter -> move -> move -> leave)
 */
export function simulateHoverSequence(
  target: Element,
  positions: Array<{ x: number; y: number }>
): void {
  if (positions.length === 0) return;

  // Enter at first position
  const enterEvent = createMouseEvent('mouseenter', {
    clientX: positions[0].x,
    clientY: positions[0].y,
  });
  target.dispatchEvent(enterEvent);

  // Move through positions
  positions.forEach((pos) => {
    simulateMouseMove(target, pos.x, pos.y);
  });

  // Leave at last position
  const leaveEvent = createMouseEvent('mouseleave', {
    clientX: positions[positions.length - 1].x,
    clientY: positions[positions.length - 1].y,
  });
  target.dispatchEvent(leaveEvent);
}

/**
 * Simulate a click event on a target element
 */
export function simulateClick(target: Element, x: number, y: number): void {
  const mouseDown = createMouseEvent('mousedown', { clientX: x, clientY: y });
  const mouseUp = createMouseEvent('mouseup', { clientX: x, clientY: y });
  const click = createMouseEvent('click', { clientX: x, clientY: y });

  target.dispatchEvent(mouseDown);
  target.dispatchEvent(mouseUp);
  target.dispatchEvent(click);
}

/**
 * Get bounding box of an SVG element (for calculating coordinates)
 */
export function getSVGElementBounds(element: SVGElement): DOMRect {
  return element.getBoundingClientRect();
}

/**
 * Convert chart-relative coordinates to client coordinates
 */
export function chartToClientCoords(
  chartElement: Element,
  chartX: number,
  chartY: number
): { x: number; y: number } {
  const bounds = chartElement.getBoundingClientRect();
  return {
    x: bounds.left + chartX,
    y: bounds.top + chartY,
  };
}

/**
 * Wait for next animation frame (useful for D3 transitions)
 */
export function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Wait for multiple animation frames
 */
export async function waitForAnimationFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await waitForAnimationFrame();
  }
}

/**
 * Helper to create a container element for chart testing
 */
export function createChartContainer(): HTMLDivElement {
  const container = document.createElement('div');
  container.style.width = '800px';
  container.style.height = '400px';
  document.body.appendChild(container);
  return container;
}

/**
 * Clean up a chart container
 */
export function cleanupChartContainer(container: HTMLElement): void {
  container.remove();
}
