/**
 * Vitest setup file
 * Runs before all tests to configure the testing environment
 */

// Mock performance.now() to return deterministic time for tests
let mockedTime = 0;

export function setMockedTime(time: number): void {
  mockedTime = time;
}

export function advanceTime(ms: number): void {
  mockedTime += ms;
}

export function resetMockedTime(): void {
  mockedTime = 0;
}

// Store original performance.now
const originalPerformanceNow = performance.now.bind(performance);

// Override performance.now() for deterministic testing
performance.now = () => mockedTime;

// Store original Date.now
const originalDateNow = Date.now.bind(Date);

// Restore originals if needed (for cleanup in tests)
export function restoreTimeFunctions(): void {
  performance.now = originalPerformanceNow;
  Date.now = originalDateNow;
}

// Make Date.now also use mocked time (in milliseconds)
Date.now = () => mockedTime;

// Add global test helpers
declare global {
  var setMockedTime: (time: number) => void;
  var advanceTime: (ms: number) => void;
  var resetMockedTime: () => void;
}

globalThis.setMockedTime = setMockedTime;
globalThis.advanceTime = advanceTime;
globalThis.resetMockedTime = resetMockedTime;

// Mock SVG methods not supported by happy-dom
// This allows D3's pointer() function to work in tests
if (typeof SVGElement !== "undefined") {
  const svgPrototype = SVGElement.prototype as SVGElement & {
    getScreenCTM?: () => unknown;
    createSVGPoint?: () => unknown;
  };

  if (!svgPrototype.getScreenCTM) {
    svgPrototype.getScreenCTM = function () {
      return {
        a: 1,
        b: 0,
        c: 0,
        d: 1,
        e: 0,
        f: 0,
        inverse: function () {
          return this;
        },
        multiply: function () {
          return this;
        },
        translate: function () {
          return this;
        },
        scale: function () {
          return this;
        },
        rotate: function () {
          return this;
        },
        skewX: function () {
          return this;
        },
        skewY: function () {
          return this;
        },
      } as any;
    };
  }

  if (!svgPrototype.createSVGPoint) {
    svgPrototype.createSVGPoint = function () {
      return {
        x: 0,
        y: 0,
        matrixTransform: function () {
          return this;
        },
      } as any;
    };
  }
}
