# Frontend Test Harness

## Overview

The frontend test harness provides infrastructure for testing chart interactions with deterministic time control. This enables reliable testing of hover behaviors, animations, and time-dependent UI interactions.

## Tech Stack

- **Test Framework**: Vitest (native Vite test runner)
- **Environment**: happy-dom (lightweight DOM implementation)
- **TypeScript**: Full type support for tests

## Running Tests

```bash
# Run all tests once
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with UI
npm run test:ui
```

## Test Structure

### Setup Files

- **`vitest.config.ts`**: Vitest configuration
- **`src/tests/setup.ts`**: Global test setup, mocks `performance.now()` and `Date.now()` for deterministic time

### Test Files

- **`src/tests/chartSurface.test.ts`**: Tests for chart surface mounting and rendering
- **`src/tests/mousemove.test.ts`**: Tests for mouse event simulation with deterministic time

### Utilities

- **`src/tests/mouseUtils.ts`**: Helper functions for simulating mouse interactions

## Deterministic Time Control

The test harness provides global functions for controlling time:

```typescript
// Set absolute time (in milliseconds)
setMockedTime(1000000);

// Advance time by a delta
advanceTime(16); // Advance by 16ms (one frame at 60fps)

// Reset time to 0
resetMockedTime();
```

Both `performance.now()` and `Date.now()` return the mocked time, ensuring consistent timing across all code paths.

## Mouse Interaction Utilities

### Creating Mouse Events

```typescript
import { createMouseEvent } from './tests/mouseUtils';

const event = createMouseEvent('mousemove', {
  clientX: 100,
  clientY: 150,
});
```

### Simulating Mouse Movement

```typescript
import { simulateMouseMove } from './tests/mouseUtils';

// Simulate moving mouse to (100, 150)
simulateMouseMove(element, 100, 150);
```

### Simulating Hover Sequences

```typescript
import { simulateHoverSequence } from './tests/mouseUtils';

// Simulate entering, moving through positions, then leaving
simulateHoverSequence(element, [
  { x: 100, y: 100 },
  { x: 150, y: 150 },
  { x: 200, y: 200 },
]);
```

### Simulating Clicks

```typescript
import { simulateClick } from './tests/mouseUtils';

simulateClick(element, 100, 150);
```

## Chart Testing Utilities

### Creating Test Containers

```typescript
import { createChartContainer, cleanupChartContainer } from './tests/mouseUtils';

// In beforeEach
const container = createChartContainer();

// In afterEach
cleanupChartContainer(container);
```

### Converting Coordinates

```typescript
import { chartToClientCoords } from './tests/mouseUtils';

// Convert chart-relative coords to client coords
const clientCoords = chartToClientCoords(chartElement, 50, 75);
```

## Example: Testing Chart Hover

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChartView } from '../chart/ChartView';
import {
  createChartContainer,
  cleanupChartContainer,
  simulateMouseMove,
} from './mouseUtils';

describe('Chart Hover Interactions', () => {
  let container: HTMLDivElement;
  let chart: ChartView;

  beforeEach(() => {
    resetMockedTime();
    setMockedTime(Date.now());

    container = createChartContainer();
    chart = new ChartView(container, {
      width: 800,
      height: 400,
      // ... other config
    });
  });

  afterEach(() => {
    cleanupChartContainer(container);
  });

  it('should show tooltip on hover', () => {
    const svg = container.querySelector('svg')!;

    // Simulate mouse move to chart center
    simulateMouseMove(svg, 400, 200);

    // Advance time for any debounced/throttled handlers
    advanceTime(100);

    // Assert tooltip appears
    const tooltip = container.querySelector('.tooltip');
    expect(tooltip).toBeTruthy();
  });
});
```

## Test Coverage

The current test suite covers:

1. **Chart Surface Mounting** (8 tests)
   - SVG creation and structure
   - Proper margin/transform application
   - Clip-path setup
   - Axis rendering
   - Event listener attachment
   - Metric addition after mount
   - Deterministic dimensions

2. **Mouse Event Simulation** (10 tests)
   - Basic mouse event creation
   - Event capture and propagation
   - Deterministic time tracking
   - Hover sequences (enter/move/leave)
   - Click simulation (down/up/click)
   - Coordinate conversion
   - Rapid sequential events
   - Time reset between scenarios
   - Multiple event listeners

## Best Practices

1. **Always reset time in `beforeEach`**:
   ```typescript
   beforeEach(() => {
     resetMockedTime();
     setMockedTime(Date.now());
   });
   ```

2. **Clean up containers in `afterEach`**:
   ```typescript
   afterEach(() => {
     cleanupChartContainer(container);
   });
   ```

3. **Use deterministic time for consistency**:
   ```typescript
   // Instead of waiting for real time
   // await new Promise(resolve => setTimeout(resolve, 100));
   
   // Advance mocked time
   advanceTime(100);
   ```

4. **Test event sequences, not just single events**:
   ```typescript
   simulateHoverSequence(element, [
     { x: 100, y: 100 },
     { x: 150, y: 150 },
   ]);
   ```

## Future Enhancements

Potential additions to the test harness:

- Drag-and-drop simulation utilities
- Touch event simulation for mobile
- Keyboard event utilities
- Visual regression testing with snapshots
- Performance benchmarking utilities
- Mock WebSocket for real-time data tests
- Mock API responses for integration tests

## CI/CD Integration

Tests run automatically in CI pipelines. The test command exits with code 0 on success and non-zero on failure, making it suitable for gate checks.

```bash
# In CI pipeline
npm test
```

## Troubleshooting

### Tests timing out

If tests timeout, check for:
- Missing `advanceTime()` calls when code waits for time to pass
- Event listeners not being properly cleaned up
- Infinite loops or recursive calls

### Events not being captured

Ensure:
- Event listeners are attached before simulating events
- Events bubble up correctly (set `bubbles: true`)
- Target element is part of the DOM

### Inconsistent time values

Always use the mocked time functions:
- Use `performance.now()` instead of `Date.now()` for high precision
- Call `resetMockedTime()` in `beforeEach` for isolation
