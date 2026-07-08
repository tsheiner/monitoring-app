"""Tests for catalog-backed scenario scheduling and APIs."""

from fastapi.testclient import TestClient

from server.http_api import app
from simulator.event_generator import EventGenerator
from simulator.realistic_generator import RealisticMetricsGenerator
from simulator.scenarios import SCENARIO_DEFINITIONS, ScenarioManager


def test_scenario_definitions_include_v1_catalog_timelines():
    expected = {
        "dhcp_outage",
        "major_switch_failure",
        "rogue_ap_attack",
        "firmware_rollout_failure",
        "high_density_surge",
    }

    assert expected <= set(SCENARIO_DEFINITIONS)
    for scenario in SCENARIO_DEFINITIONS.values():
        assert scenario.steps
        offsets = [step.offset_seconds for step in scenario.steps]
        assert offsets == sorted(offsets)


def test_scenario_events_emit_in_order_and_create_perturbations(fixed_timestamp):
    event_generator = EventGenerator(config_path="simulator/config_enterprise.json")
    metrics_generator = RealisticMetricsGenerator(
        config_path="simulator/config_enterprise.json",
        start_time=fixed_timestamp,
    )
    event_generator.set_metrics_generator(metrics_generator)

    emitted = []
    event_generator.register_callback(emitted.append)
    run = event_generator.trigger_scenario(
        "dhcp_outage",
        entity="AP-Floor1-01",
        severity="critical",
        started_at=fixed_timestamp,
    )

    first_events = event_generator.emit_due_scenario_events(fixed_timestamp)
    later_events = event_generator.emit_due_scenario_events(fixed_timestamp + 800)
    events = first_events + later_events

    assert [event["timestamp"] for event in events] == sorted(
        event["timestamp"] for event in events
    )
    assert len(events) == len(SCENARIO_DEFINITIONS["dhcp_outage"].steps)
    assert emitted == events
    assert events[0]["event_source"] == "scenario"
    assert events[0]["scenario_id"] == "dhcp_outage"
    assert events[0]["scenario_run_id"] == run.scenario_run_id
    assert events[0]["affected_classifiers"] == ["dhcp"]
    assert metrics_generator.perturbation_manager.active_count > 0


def test_scenario_manager_reports_active_runs(fixed_timestamp):
    manager = ScenarioManager()
    run = manager.trigger(
        "high_density_surge",
        entity="AP-Floor2-01",
        severity="warning",
        started_at=fixed_timestamp,
    )

    active = manager.active_runs(fixed_timestamp + 30)

    assert len(active) == 1
    assert active[0]["scenario_run_id"] == run.scenario_run_id
    assert active[0]["scenario_id"] == "high_density_surge"
    assert active[0]["scheduled_events"]


def test_triggered_scenario_events_are_stored_in_events_db(
    isolated_events_store,
    fixed_timestamp,
):
    generator = EventGenerator(config_path="simulator/config_enterprise.json")
    generator.register_callback(isolated_events_store.insert_event)
    run = generator.trigger_scenario(
        "rogue_ap_attack",
        entity="AP-Floor3-02",
        severity="critical",
        started_at=fixed_timestamp,
    )

    emitted = generator.emit_due_scenario_events(fixed_timestamp + 900)
    stored = isolated_events_store.query_range(
        fixed_timestamp - 1,
        fixed_timestamp + 901,
    )

    assert len(stored) == len(emitted)
    assert stored[0]["event_source"] == "scenario"
    assert stored[0]["scenario_id"] == "rogue_ap_attack"
    assert stored[0]["scenario_run_id"] == run.scenario_run_id


def test_scenario_api_lists_triggers_and_reports_active(monkeypatch):
    generator = EventGenerator(config_path="simulator/config_enterprise.json")
    monkeypatch.setattr("server.http_api.get_event_generator", lambda: generator)
    client = TestClient(app)

    list_response = client.get("/api/scenarios")
    assert list_response.status_code == 200
    scenario_ids = {
        scenario["scenario_id"]
        for scenario in list_response.json()["scenarios"]
    }
    assert "dhcp_outage" in scenario_ids

    trigger_response = client.post(
        "/api/scenarios/trigger",
        json={
            "scenario_id": "dhcp_outage",
            "entity": "AP-Floor1-01",
            "severity": "critical",
        },
    )
    assert trigger_response.status_code == 200
    triggered = trigger_response.json()
    assert triggered["scenario_id"] == "dhcp_outage"
    assert triggered["emitted_events"][0]["event_source"] == "scenario"
    assert triggered["emitted_events"][0]["scenario_run_id"]

    active_response = client.get("/api/scenarios/active")
    assert active_response.status_code == 200
    active = active_response.json()["active"]
    assert len(active) == 1
    assert active[0]["scenario_run_id"] == triggered["scenario_run_id"]


def test_scenario_api_rejects_invalid_scenario_id(monkeypatch):
    generator = EventGenerator(config_path="simulator/config_enterprise.json")
    monkeypatch.setattr("server.http_api.get_event_generator", lambda: generator)
    client = TestClient(app)

    response = client.post(
        "/api/scenarios/trigger",
        json={
            "scenario_id": "missing_scenario",
            "entity": "AP-Floor1-01",
            "severity": "warning",
        },
    )

    assert response.status_code == 404


def test_scenario_api_rejects_invalid_entity(monkeypatch):
    generator = EventGenerator(config_path="simulator/config_enterprise.json")
    monkeypatch.setattr("server.http_api.get_event_generator", lambda: generator)
    client = TestClient(app)

    response = client.post(
        "/api/scenarios/trigger",
        json={
            "scenario_id": "dhcp_outage",
            "entity": "AP-Missing",
            "severity": "warning",
        },
    )

    assert response.status_code == 400


def test_scenario_api_validates_severity(monkeypatch):
    generator = EventGenerator(config_path="simulator/config_enterprise.json")
    monkeypatch.setattr("server.http_api.get_event_generator", lambda: generator)
    client = TestClient(app)

    response = client.post(
        "/api/scenarios/trigger",
        json={
            "scenario_id": "dhcp_outage",
            "entity": "AP-Floor1-01",
            "severity": "info",
        },
    )

    assert response.status_code == 422
