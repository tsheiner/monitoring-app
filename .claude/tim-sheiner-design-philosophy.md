# Tim Sheiner's Monitoring & Analytics Design Philosophy

A reference for AI-assisted monitoring project collaboration.

---

## Core Framework: Four Data Workflows

Tim distinguishes four fundamentally different workflows for working with data:

| Workflow | Purpose | Time Focus | Attention Required |
|----------|---------|------------|-------------------|
| **Analytics** | Understanding what HAS happened | Past | High (exploration, iteration) |
| **Monitoring** | Seeing what IS happening | Present | Low (until alerts) |
| **Modeling** | Encoding what DOES happen | Timeless patterns | High (building) |
| **Simulation** | Predicting what MIGHT happen | Future | High (scenario planning) |

**Key insight**: Analytics is a precursor to monitoring. You must understand a system before you can meaningfully watch it.

---

## Analytics vs Monitoring: The Essential Distinction

### Analytics UX = Understanding
- High focus, lots of attention, iterative approach
- Data tends to be complex reports of **intrinsic properties**
- Use cases: planning, preparing reports, strategy
- Visualization: tables, comparisons, multi-dimensional views

### Monitoring UX = Action
- Low attention until alerts fire
- Data tends to be simple time-series of **extrinsic properties**
- Use cases: operations, incident response, real-time management
- Visualization: line charts, status indicators, alert streams

**Design principle**: "Analysis UX is for understanding; Monitoring UX is for action."

---

## The Analytic Workflow: "Play Produces Insight"

A universal, instinctual pattern Tim has observed across domains:

```
Navigate → Play → Share
    ↑________|  |_______↓
         (cycles)
```

### The Play Step
- Where most time is spent and most learning occurs
- "Play" conveys both experimentation and fun
- First goal: find patterns in the data
- Second goal: understand how changes affect patterns
- **The aha moment**: proving to yourself you can predict the effect of a change

### The Heroic Narrative
The workflow tells a story: an individual creating new knowledge for their community. It begins with a question and passion, follows through personal discovery, and closes with sharing insights that make the community wiser.

**Design implication**: Tools should become "trusted and dependable friends" - not just problem solvers.

---

## The Monitoring Workflow: "How to Watch a System"

### Steady State Reality
- **Most of the time**: doing nothing
- **Some of the time**: responding to alerts
- **Some of the time**: understanding why alerts happened

### The Hard Part
Getting set up is harder than operating. The monitoring workflow, once it reaches steady state, is simple.

### Pipeline Components
1. **Data**: Connecting to signals (usually the hardest part)
2. **Meaning**: Assigning context and value to signals
3. **Streams**: Raw events ordered by time
4. **Compute**: Transform events into metrics
5. **History**: Storage at settable resolution
6. **Visualization**: Components bound to metrics
7. **Alerts**: Triggers when conditions match

---

## The Hierarchy of Abstraction

Different roles need different levels of data abstraction:

| Level | Audience | Data Type |
|-------|----------|-----------|
| Top | Executives | **Scores** |
| Middle | Managers | **Metrics** |
| Bottom | Builders | **Events** |

---

## Metric Display Standards

### The Canonical Metric Tile
A data visualization that must show the current value and ideally historical comparison.

**Required elements**:
- Label (meaningful name, acts as link to detail)
- Value (most recent reading)
- Unit (critical for meaning)
- Timestamp (when measured, not when received)

**Optional elements**:
- Trend indicator (direction + amount of change)
- Note (context for infrequent viewers)
- Time series (shows range, rate, cycles intuitively)
- Range selector (for time period)

### Critical Design Principle
> "Almost no one wants their monitoring entry point to be a metric display. Instead, people want real-time alerts on high visibility channels that grab their attention."

**Alerts and metrics are two sides of the same coin.** When requirements include metrics, the UX strategy must also include alerting.

---

## Understanding Data

### Observations vs Statistics
- **Observations**: As close to absolute truth as possible
- **Statistics**: Opinions, not facts. They summarize but contain less information than the observations they derive from.

> "A statistic is a point of view, a particular approach to summarizing the world, that may be helpful but always contains less information than the observations from which it was derived."

### Continuous vs Categorical
- **Continuous** (metrics/measures): Quantities across a range, visualized with lines
- **Categorical** (discrete/dimensions): Groups or categories, visualized with bars

### Time is Special
- Universal, directional, unalterable
- Simultaneously linear and rhythmic
- **Always valid to correlate quantities by time**

### Structured vs Unstructured
- Structured: Name-value pairs, fast to process
- Unstructured: Images, video, text, logs - meaningful but expensive to parse
- **The pool of structured data is always growing** (this is what humans do)

---

## Uncertainty: A Precise Concept

In prediction sciences, uncertainty is precise and critical:

```
measurement = true_value + uncertainty
uncertainty = error + variance
```

- **Error**: Device/measurement inaccuracy
- **Variance**: Natural variation in living/dynamic systems

**Key insight**: Certainty cannot be measured directly, but uncertainty can.

---

## The Business Case for Monitoring

### What Successful Companies Do Well
1. Monitor how people use their systems
2. React in near-real time to changes in usage
3. Apply ML to historical data for better decisions

### The Opportunity
> "Make it easy for organizations from every different kind of community to have access to near real time data about the performance of their business processes, their customer's behavior, and their usage of expensive or critical resources."

Most organizations aren't doing this because it's intellectually complex, technically complicated, and resource-intensive. The opportunity is to make it friendly, usable, and cost-effective.

---

## Design Principles Summary

1. **Distinguish workflows clearly** - Analytics, monitoring, modeling, and simulation have different UX needs
2. **Entry point matters** - Start with alerts, not dashboards
3. **Play enables insight** - Make exploration fun and iterative
4. **Sharing completes the cycle** - Analytics naturally progresses from personal to public
5. **Statistics are opinions** - Preserve access to underlying observations
6. **Time is fundamental** - Always valid to correlate by time
7. **Alerts + Metrics = One system** - Design them together
8. **Setup is the hard part** - Once monitoring reaches steady state, it's simple
9. **Match abstraction to audience** - Scores/metrics/events for executives/managers/builders
10. **Tools should be friends** - Trusted, dependable, enabling reputation-building

---

*Reference document created from Tim Sheiner's Medium writings, February 2026*
