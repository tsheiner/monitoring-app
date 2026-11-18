# Design

## Context

See proposal.md for motivation and the spec delta for expected behavior.
The Metrics panel is a flex column inside an automatically sized grid
column. Its metric controls and existing minimum width establish the
panel width.

## Goals / Non-Goals

**Goals:**
- Let the note use the panel's existing content width and grow vertically
  as its text wraps.

**Non-Goals:**
- Changing the panel or grid sizing policy or metric selection logic.

## Decisions

### Render the note as a static HTML paragraph

Place it directly after the Metrics heading. Static HTML keeps this
state-independent copy simpler than generating it through JavaScript.
Use a dedicated class for secondary typography and spacing so styling
stays local to the note rather than affecting other sidebar content.

### Keep the note out of the panel's width calculation

Use inline-size containment on the note. Its text will contribute no
intrinsic horizontal size; the existing flex layout will stretch it to
the panel's content width while allowing its height to fit wrapped text.
The metric controls and existing minimum width will continue determining
the panel width.

A fixed width for the note would introduce a separate sizing rule.
JavaScript measurement would add state and synchronization for a layout
relationship CSS can express directly.

## Risks / Trade-offs

- Incorrect containment could affect text height or allow the note to
  widen the panel. Use inline-size containment, retain content-driven
  height, and verify the full note is visible without overlap. Compare
  panel widths with and without the note at the same viewport.
