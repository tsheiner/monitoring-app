# README Rewrite: Execution Plan

## Agent Prompt

You are rewriting the README.md for a network monitoring simulator application. Your audience is **product managers and non-technical stakeholders** who need to understand what this tool does and how it produces realistic data — they will not read the code but they may the app locally.

This application is a **data engine for prototyping**. It simulates realistic WiFi network monitoring data that can drive any number of UIs, AI chat interfaces, or alerting systems. The simulation is the product — the included UI exists only to visualize the output and validate the data structures.

You must follow a **TDD approach**: write the validation script first, then write the README until all validations pass.

### Key rules
- Use the application's actual terminology (metric names, classifier names, event types) at all times
- Use ASCII art to convey architecture and concepts visually — at least 3 diagrams
- Do NOT include code blocks with Python/JS/JSON syntax — this is for a non-technical audience
- Do NOT describe future plans or unimplemented features — describe what exists today
- Do NOT reference `Darts`, `rf_quality` driver, or `infra_health` driver — these are removed/legacy
- DO mention all 7 metrics, all 20 classifiers, all event types, the 3 network profiles
- The single new README.md replaces both the existing README.md and QUICKSTART.md

---

## Context

The current README.md and QUICKSTART.md are developer-oriented documents with setup instructions, code snippets, and stale architectural descriptions. The simulator has evolved significantly — it now uses a **classifier-based architecture** where infrastructure sub-components (classifiers) are the simulation primitive, and metrics are derived consequences. This is the central story the README must tell.

### Source of truth files (read these to extract exact terminology and data)

| File | What to extract |
|------|----------------|
| `backend/simulator/realistic_generator.py` | `CLASSIFIER_DEFINITIONS` (all 20 classifiers), `METRIC_CLASSIFIERS` (which classifiers map to which metrics with weights), `CLIENT_LOAD_CONFIG`, `NETWORK_PROFILES`, daily profile functions, OU process implementation |
| `backend/simulator/perturbations.py` | `PERTURBATION_TEMPLATES` (all event types and which classifiers they target), decay types |
| `backend/simulator/event_generator.py` | `EVENT_TYPES` list, entity list |
| `backend/simulator/bootstrap.py` | `TIERS` (aggregation tiers), bootstrap process description |
| `backend/simulator/config_enterprise.json` | Metric baselines, ranges, AP topology |
| `backend/main.py` | System orchestration, ports, startup sequence |
| `docs/factor-decomposition-plan.md` | Classifier architecture design rationale, classifier-metric table, event-classifier cascade table |

---

## Step 1: Create validation script

Create `scripts/validate_readme.py`. This script reads README.md and checks it against the actual codebase. It must be runnable from the project root.

### Validation checks

**1. Terminology accuracy**
- Every metric name from `METRIC_CLASSIFIERS.keys()` must appear in the README (all 7)
- Every classifier name from `CLASSIFIER_DEFINITIONS.keys()` must appear in the README (all 20)
- Key event types from `PERTURBATION_TEMPLATES.keys()` must appear in the README

**2. Completeness**
- All 7 metrics present
- All 20 classifiers present
- All 3 network profiles mentioned (enterprise, campus, hospital)
- Bootstrap concept mentioned
- Ornstein-Uhlenbeck process mentioned (either by name or as "mean-reverting random walk")
- Daily profiles / diurnal patterns mentioned
- client_load environmental condition mentioned

**3. Classifier-metric mapping accuracy**
- For each metric, verify the README lists the correct classifiers as belonging to that metric
- Parse the README's structured table/list sections to verify parent-child relationships match `METRIC_CLASSIFIERS`

**4. No stale terminology**
- Must NOT contain "rf_quality" (removed driver)
- Must NOT contain "infra_health" (removed driver)
- Must NOT contain "Darts" as a current technology (replaced by OU process)
- Must NOT contain "METRIC_OU_NOISE" or "METRIC_SENSITIVITIES"

**5. Structural checks**
- Contains at least 3 ASCII art diagrams (blocks with box-drawing characters like `─`, `│`, `┌`, `└`, `→`, or lines of `+`, `|`, `-`)
- Does NOT contain fenced code blocks with language specifiers (```python, ```javascript, ```json, etc.)
- Contains "## " headings (well-structured document)

### Implementation approach for the script

The script should:
- Add `backend/` to `sys.path` so it can import from simulator modules directly
- Import `CLASSIFIER_DEFINITIONS`, `METRIC_CLASSIFIERS` from `simulator.realistic_generator`
- Import `PERTURBATION_TEMPLATES` from `simulator.perturbations`
- Read `README.md` as plain text
- Run each check category, collecting pass/fail results with details
- Print a summary and exit non-zero if any check fails

---

## Step 2: Run the script against the existing README

It should fail on most checks. This confirms the tests are meaningful.

---

## Step 3: Write the new README.md

### Document structure

```
# Network Monitoring Simulator

## What This Is
  One paragraph: a data engine that produces realistic WiFi network
  monitoring data for prototyping UIs, AI assistants, and alerting systems.

  ASCII ART: high-level view
  ┌──────────────┐     ┌─────────┐     ┌──────────────────┐
  │  Simulation  │────>│  Data   │────>│  Any Consumer    │
  │  Engine      │     │  Store  │     │  (UI, AI, Alert) │
  └──────────────┘     └─────────┘     └──────────────────┘

## The Seven Metrics
  Table with: metric name, what it measures, units, typical range
  Brief note: industry-standard WiFi health indicators

## How the Simulation Works
  ASCII ART: the full causal pipeline
  event → perturbation → classifier(s) → metric value

  Plain English walkthrough of each layer:
  - Events are things that happen in the network
  - Perturbations are temporary effects on classifiers
  - Classifiers are infrastructure sub-components with health scores
  - Metrics are computed from their classifiers

## Classifiers: The Heart of the Simulation
  What a classifier is (sub-component, 0-1 health score, own behavior)

  ASCII ART: decomposition example showing one metric broken into classifiers

  Table: all 7 metrics with their classifiers and weights
  (This is the key reference table — must match METRIC_CLASSIFIERS exactly)

  Key insight: classifiers are SHARED — e.g. the single "dhcp" classifier
  drives both successful_connects and time_to_connect simultaneously.
  A DHCP problem automatically degrades both metrics.

## Events and Perturbations
  Events → perturbation → classifier cascade explanation

  ASCII ART: cascade example showing how one event ripples through

  Table: event types with which classifiers they affect and decay behavior

## What Makes the Data Look Real
  Four mechanisms, each explained in plain English:

  1. Daily profiles — smooth sinusoidal curves that give each metric a
     time-of-day personality (busy afternoons, quiet nights)

  2. Mean-reverting noise (Ornstein-Uhlenbeck) — gentle random variation
     that always drifts back toward normal, never jumps or jitters

  3. Bootstrap — 30 days of simulated history that establishes what
     "normal" looks like for each classifier and metric

  4. Environmental condition (client_load) — models diurnal human
     activity as an exogenous force that modulates everything

  Classifier health thresholds (green/yellow/red) are derived from
  bootstrap observations, not hardcoded — ensuring consistency.

## Network Profiles
  Three environments with different character:
  - Enterprise: standard office, business-hours patterns
  - Campus: university with class schedules and dorm usage
  - Hospital: 24/7 facility with high reliability requirements

  Each profile defines AP topology, metric baselines, and timing patterns.

## The Data Pipeline
  ASCII ART: full system architecture
  Bootstrap → Tiered Storage → HTTP API + WebSocket → Consumers

  - Bootstrap generates 30 days of tiered history (raw → aggregated)
  - Live streaming adds observations every 10 seconds
  - 30-day rolling window with automatic daily cleanup
  - HTTP API for historical queries, WebSocket for real-time stream

## Running the Application
  Minimal plain-English instructions (no code blocks):
  - What you need installed (Python, Node.js)
  - Start the backend (generates history, then streams live)
  - Start the frontend (opens a browser dashboard)
  - What you'll see: chart with metric traces, distribution ribbons,
    event markers, live updates
  - Ports: backend HTTP on 5011, WebSocket on 5010, frontend on 5012
```

---

## Step 4: Run validation script — iterate until all checks pass

After writing the README, run:

```
cd /path/to/monitoring-app
python scripts/validate_readme.py
```

Fix any failures by editing the README. Repeat until all checks pass.

---

## Step 5: Delete QUICKSTART.md

Remove the file — its content is consolidated into the new README.

---

## Verification checklist

- [ ] `python scripts/validate_readme.py` exits with code 0 (all checks pass)
- [ ] README contains no Python/JS/JSON code blocks
- [ ] README contains at least 3 ASCII art diagrams
- [ ] README reads clearly to someone who has never seen the codebase
- [ ] All terminology matches actual codebase objects exactly
- [ ] No references to removed concepts (Darts, rf_quality, infra_health)
- [ ] QUICKSTART.md is deleted
