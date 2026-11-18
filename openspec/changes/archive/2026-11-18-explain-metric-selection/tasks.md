# Tasks

## 1. Metrics guidance

- [x] 1.1 Add the approved note and scoped CSS; verify its copy, placement, complete wrapping, and spacing from the controls.
- [x] 1.2 Verify that the metric buttons continue to determine panel width, subject to the existing minimum width. Compare the layout with the hint shown and hidden, then repeat with a temporarily lengthened metric label. Restore the label after verification.

## 2. Integration verification

- [x] 2.1 Run the frontend build and existing metric-selection tests; verify both pass.
- [x] 2.2 Check single-click selection and Shift-click comparison in the running app; verify both interactions still work.

## Workflow follow-up

- Review the finished interface, then archive the completed change.

## Verification evidence

- `npm run build` in `frontend/`: passed.
- `npm test -- src/tests/metricSelection.test.ts` in `frontend/`: all 4 tests passed.
- Rendered interface at a 1252 by 900 viewport: exact note beneath Metrics, full text wrapping within the panel, and 12 pixels of space before the metric controls.
- Normal labels: panel width 226.015625 pixels with the hint both shown and hidden.
- Temporarily extended metric label: panel width 418.390625 pixels with the hint both shown and hidden. The original label was restored.
- Browser interaction: click selected Throughput alone; Shift-click added Coverage with two chart traces; clicking Roaming returned to one selected metric and one trace.
