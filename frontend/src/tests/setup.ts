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
  var setMockedTime: typeof setMockedTime;
  var advanceTime: typeof advanceTime;
  var resetMockedTime: typeof resetMockedTime;
}

globalThis.setMockedTime = setMockedTime;
globalThis.advanceTime = advanceTime;
globalThis.resetMockedTime = resetMockedTime;
