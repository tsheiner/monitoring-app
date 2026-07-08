import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonitoringApp } from "../main";
import type { APIClient } from "../api/client";
import type { ActiveScenarioRun, ScenarioDefinition } from "../chart/types";

function setupAppDOM(): void {
  document.body.innerHTML = `
    <select id="time-range"><option value="43200" selected>Last 12 Hours</option></select>
    <input type="checkbox" id="live-mode" checked />
    <button id="jump-to-now"></button>
    <div id="connection-status"></div>
    <div id="data-stats"></div>
    <div id="metrics-list"></div>
    <div id="scenario-controls">
      <select id="scenario-select"></select>
      <select id="scenario-entity"></select>
      <select id="scenario-severity">
        <option value="warning">Warning</option>
        <option value="critical">Critical</option>
      </select>
      <button id="scenario-trigger"></button>
      <div id="active-scenarios"></div>
    </div>
    <div id="events-list"></div>
    <div id="chart" style="width:800px;height:500px"></div>
  `;
}

const scenario: ScenarioDefinition = {
  scenario_id: "dhcp_outage",
  label: "DHCP Outage",
  description: "DHCP failures recover after remediation.",
  default_severity: "critical",
  allowed_severities: ["warning", "critical"],
  steps: [
    {
      offset_seconds: 0,
      event_type: "dhcp_server_overload",
      description: "Start outage",
    },
  ],
};

const activeRun: ActiveScenarioRun = {
  scenario_run_id: "scn_test",
  scenario_id: "dhcp_outage",
  label: "DHCP Outage",
  entity: "AP-Floor1-01",
  severity: "critical",
  started_at: 1_700_000_000,
  ends_at: 1_700_000_900,
  status: "active",
  emitted_count: 1,
  total_events: 4,
  scheduled_events: [],
};

function createMockApi(overrides: Partial<APIClient> = {}): APIClient {
  return {
    fetchMetricHistory: vi.fn(),
    fetchBaseline: vi.fn(),
    fetchClassifierBaseline: vi.fn(),
    fetchEvents: vi.fn(),
    fetchScenarios: vi.fn(async () => ({ scenarios: [scenario] })),
    fetchActiveScenarios: vi.fn(async () => ({ active: [] })),
    triggerScenario: vi.fn(async () => ({
      scenario_run_id: "scn_test",
      scenario_id: "dhcp_outage",
      entity: "AP-Floor1-01",
      severity: "critical",
      started_at: 1_700_000_000,
      ends_at: 1_700_000_900,
      scheduled_events: [
        { event_type: "dhcp_server_overload" },
      ],
      emitted_events: [
        {
          timestamp: 1_700_000_000,
          event_type: "dhcp_server_overload",
          severity: "critical",
          entity: "AP-Floor1-01",
          message: "DHCP server overload affecting AP-Floor1-01",
          event_source: "scenario",
          event_group: "connection_auth",
          affected_classifiers: ["dhcp"],
          scenario_id: "dhcp_outage",
          scenario_run_id: "scn_test",
          metadata: {},
        },
      ],
    })),
    connectWebSocket: vi.fn(),
    onMetric: vi.fn(),
    onEvent: vi.fn(),
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
    onReconnect: vi.fn(),
    disconnectWebSocket: vi.fn(),
    isConnected: vi.fn(() => false),
    ...overrides,
  } as unknown as APIClient;
}

describe("Scenario controls", () => {
  beforeEach(() => {
    setupAppDOM();
    setMockedTime(1_700_000_000_000);
  });

  it("renders scenario list and active empty state", async () => {
    const api = createMockApi();
    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: api,
    });

    (app as any).setupControls();
    await (app as any).loadScenarioControls();
    await (app as any).refreshActiveScenarios();

    const scenarioSelect = document.getElementById(
      "scenario-select",
    ) as HTMLSelectElement;
    const activeScenarios = document.getElementById("active-scenarios");

    expect(scenarioSelect.options[0].value).toBe("dhcp_outage");
    expect(scenarioSelect.options[0].textContent).toBe("DHCP Outage");
    expect(activeScenarios?.textContent).toContain("No active scenarios");
  });

  it("triggers selected scenario and renders active run", async () => {
    const api = createMockApi({
      fetchActiveScenarios: vi.fn(async () => ({ active: [activeRun] })),
    });
    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: api,
    });

    (app as any).setupControls();
    await (app as any).loadScenarioControls();
    (document.getElementById("scenario-severity") as HTMLSelectElement).value =
      "critical";

    await (app as any).triggerSelectedScenario();

    expect(api.triggerScenario).toHaveBeenCalledWith({
      scenario_id: "dhcp_outage",
      entity: "AP-Floor1-01",
      severity: "critical",
    });
    expect((app as any).allEvents).toHaveLength(1);
    expect(document.getElementById("active-scenarios")?.textContent).toContain(
      "DHCP Outage",
    );
  });

  it("counts expanded event groups", () => {
    const api = createMockApi();
    const app = new MonitoringApp({
      autoStart: false,
      connectWebSocket: false,
      apiClient: api,
    });

    (app as any).setupControls();
    (app as any).loadedRange = [100, 200];
    (app as any).allEvents = [
      { timestamp: 120, event_type: "dhcp_server_overload", message: "DHCP" },
      { timestamp: 130, event_type: "interference_event", message: "RF" },
      { timestamp: 140, event_type: "rogue_ap", message: "Rogue" },
      { timestamp: 150, event_type: "ai_action", message: "AI" },
    ];

    (app as any).updateEventDisplay();

    expect(
      document.querySelector('[data-group="connection_auth"] span')?.textContent,
    ).toBe("Connection/Auth 1");
    expect(
      document.querySelector('[data-group="rf_capacity"] span')?.textContent,
    ).toBe("RF/Capacity 1");
    expect(
      document.querySelector('[data-group="security"] span')?.textContent,
    ).toBe("Security 1");
    expect(
      document.querySelector('[data-group="ai"] span')?.textContent,
    ).toBe("AI 1");
  });
});
