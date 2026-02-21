"""
Tests for FD-020: Fix HTTP API classifier data flow.

Tests that classifier data is preserved in aggregated metric responses,
and that classifier API endpoints are accessible.
"""
import json
import tempfile
import os
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from server.http_api import app
from storage.metrics_store import get_metrics_store


@pytest.fixture
def api_client():
    """Create test client for API."""
    return TestClient(app)


@pytest.fixture
def store_with_multi_ap_classifiers(isolated_metrics_store, fixed_timestamp):
    """Populate store with observations from two APs, each with classifier data."""
    store = isolated_metrics_store

    observations = [
        # AP-1 at timestamp T: DHCP=0.98 (green), auth=0.96 (green)
        {
            "timestamp": fixed_timestamp,
            "metric": "successful_connects",
            "value": 97.0,
            "entity": "AP-Floor1-01",
            "classifiers": [
                {"name": "dhcp", "value": 0.98, "status": "green", "contribution": 0.1, "weight": 0.40},
                {"name": "authorization", "value": 0.96, "status": "green", "contribution": 0.05, "weight": 0.25},
            ],
        },
        # AP-2 at timestamp T: DHCP=0.72 (red), auth=0.93 (green)
        {
            "timestamp": fixed_timestamp,
            "metric": "successful_connects",
            "value": 88.0,
            "entity": "AP-Floor2-01",
            "classifiers": [
                {"name": "dhcp", "value": 0.72, "status": "red", "contribution": -2.1, "weight": 0.40},
                {"name": "authorization", "value": 0.93, "status": "green", "contribution": -0.1, "weight": 0.25},
            ],
        },
        # AP-1 at T+10
        {
            "timestamp": fixed_timestamp + 10,
            "metric": "successful_connects",
            "value": 96.5,
            "entity": "AP-Floor1-01",
            "classifiers": [
                {"name": "dhcp", "value": 0.97, "status": "green", "contribution": 0.08, "weight": 0.40},
                {"name": "authorization", "value": 0.95, "status": "green", "contribution": 0.03, "weight": 0.25},
            ],
        },
        # AP-2 at T+10
        {
            "timestamp": fixed_timestamp + 10,
            "metric": "successful_connects",
            "value": 89.0,
            "entity": "AP-Floor2-01",
            "classifiers": [
                {"name": "dhcp", "value": 0.74, "status": "red", "contribution": -1.9, "weight": 0.40},
                {"name": "authorization", "value": 0.94, "status": "green", "contribution": -0.08, "weight": 0.25},
            ],
        },
    ]

    store.insert_batch(observations)
    return store


class TestAggregatedObservationsIncludeClassifiers:
    """FD-020 core requirement: classifiers must be present in aggregated responses."""

    def test_aggregated_observations_include_classifiers(
        self,
        api_client,
        store_with_multi_ap_classifiers,
        fixed_timestamp,
        monkeypatch,
    ):
        """
        When entity=_aggregated, each returned observation must include a
        'classifiers' array with averaged classifier values.
        """
        monkeypatch.setattr(
            "server.http_api.get_metrics_store",
            lambda: store_with_multi_ap_classifiers,
        )

        response = api_client.get(
            "/api/metrics/successful_connects",
            params={
                "start": fixed_timestamp - 1,
                "end": fixed_timestamp + 15,
                "entity": "_aggregated",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["observations"]) == 2

        obs = data["observations"][0]
        # Value should be mean across the two APs
        assert abs(obs["value"] - 92.5) < 0.01  # (97 + 88) / 2

        # Classifiers must be present
        assert "classifiers" in obs
        assert obs["classifiers"] is not None
        assert len(obs["classifiers"]) > 0

        # DHCP classifier values should be averaged: (0.98 + 0.72) / 2 = 0.85
        dhcp = next(c for c in obs["classifiers"] if c["name"] == "dhcp")
        assert abs(dhcp["value"] - 0.85) < 0.01

    def test_aggregated_classifier_values_are_averaged(
        self,
        api_client,
        store_with_multi_ap_classifiers,
        fixed_timestamp,
        monkeypatch,
    ):
        """Classifier values must be the mean across all APs at each timestamp."""
        monkeypatch.setattr(
            "server.http_api.get_metrics_store",
            lambda: store_with_multi_ap_classifiers,
        )

        response = api_client.get(
            "/api/metrics/successful_connects",
            params={
                "start": fixed_timestamp - 1,
                "end": fixed_timestamp + 15,
                "entity": "_aggregated",
            },
        )

        assert response.status_code == 200
        data = response.json()

        obs0 = data["observations"][0]  # timestamp T
        obs1 = data["observations"][1]  # timestamp T+10

        dhcp0 = next(c for c in obs0["classifiers"] if c["name"] == "dhcp")
        dhcp1 = next(c for c in obs1["classifiers"] if c["name"] == "dhcp")

        # T: (0.98 + 0.72) / 2 = 0.85
        assert abs(dhcp0["value"] - 0.85) < 0.01
        # T+10: (0.97 + 0.74) / 2 = 0.855
        assert abs(dhcp1["value"] - 0.855) < 0.01

        # auth at T: (0.96 + 0.93) / 2 = 0.945
        auth0 = next(c for c in obs0["classifiers"] if c["name"] == "authorization")
        assert abs(auth0["value"] - 0.945) < 0.01

    def test_aggregated_classifier_has_status_field(
        self,
        api_client,
        store_with_multi_ap_classifiers,
        fixed_timestamp,
        monkeypatch,
    ):
        """Each aggregated classifier must include a 'status' field."""
        monkeypatch.setattr(
            "server.http_api.get_metrics_store",
            lambda: store_with_multi_ap_classifiers,
        )

        response = api_client.get(
            "/api/metrics/successful_connects",
            params={
                "start": fixed_timestamp - 1,
                "end": fixed_timestamp + 15,
                "entity": "_aggregated",
            },
        )

        data = response.json()
        obs = data["observations"][0]

        for c in obs["classifiers"]:
            assert "status" in c
            assert c["status"] in ("green", "yellow", "red")

    def test_aggregated_without_classifiers_still_works(
        self,
        api_client,
        isolated_metrics_store,
        fixed_timestamp,
        monkeypatch,
    ):
        """Aggregation should gracefully handle observations without classifiers."""
        store = isolated_metrics_store
        store.insert_batch([
            {"timestamp": fixed_timestamp, "metric": "throughput", "value": 100.0, "entity": "AP-1"},
            {"timestamp": fixed_timestamp, "metric": "throughput", "value": 120.0, "entity": "AP-2"},
        ])

        monkeypatch.setattr("server.http_api.get_metrics_store", lambda: store)

        response = api_client.get(
            "/api/metrics/throughput",
            params={
                "start": fixed_timestamp - 1,
                "end": fixed_timestamp + 1,
                "entity": "_aggregated",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data["observations"]) == 1
        assert abs(data["observations"][0]["value"] - 110.0) < 0.01
        # No classifiers is fine — should be None or absent
        assert data["observations"][0].get("classifiers") is None


class TestClassifierApiEndpointsAccessible:
    """FD-020 route ordering check: classifier endpoints must be reachable."""

    def test_classifier_api_endpoint_accessible(
        self,
        api_client,
        isolated_metrics_store,
        fixed_timestamp,
        monkeypatch,
    ):
        """
        /api/metrics/{metric}/classifiers/current must not be shadowed by
        the shorter /api/metrics/{metric} route.
        """
        store = isolated_metrics_store
        store.insert_batch([
            {
                "timestamp": fixed_timestamp,
                "metric": "time_to_connect",
                "value": 1.8,
                "entity": "_global",
                "classifiers": [
                    {"name": "dhcp", "value": 0.99, "status": "green", "contribution": 0.01, "weight": 0.40},
                ],
            }
        ])

        monkeypatch.setattr("server.http_api.get_metrics_store", lambda: store)

        response = api_client.get("/api/metrics/time_to_connect/classifiers/current")
        # Should be 200 (data present), not 404 from route shadowing
        assert response.status_code == 200
        data = response.json()
        assert data["metric"] == "time_to_connect"
        assert "classifiers" in data

    def test_classifier_baseline_endpoint_returns_data(
        self,
        api_client,
        tmp_path,
        monkeypatch,
    ):
        """
        /api/classifiers/{classifier}/baseline must return classifier hourly data
        when baselines.json contains classifiers section.
        """
        # Create a minimal baselines.json with classifier data
        baselines = {
            "generated_at": "2026-02-01T00:00:00",
            "lookback_days": 30,
            "classifiers": {
                "dhcp": [
                    {
                        "hour": h,
                        "distribution": {
                            "p1": 0.90, "p5": 0.92, "p10": 0.94, "p25": 0.96,
                            "p50": 0.98, "p75": 0.99, "p90": 0.995, "p95": 0.998,
                            "p99": 0.999, "mean": 0.975, "stddev": 0.02,
                        },
                        "sample_count": 100,
                    }
                    for h in range(24)
                ]
            },
        }

        baselines_path = tmp_path / "baselines.json"
        baselines_path.write_text(json.dumps(baselines))

        # Monkeypatch Path("data/baselines.json") in http_api
        import server.http_api as http_api_module
        original_path_class = http_api_module.Path

        class PatchedPath:
            def __init__(self, *args):
                self._path = original_path_class(*args)
                self._patched = str(self._path) == "data/baselines.json"
                if self._patched:
                    self._path = baselines_path

            def exists(self):
                return self._path.exists()

            def __fspath__(self):
                return str(self._path)

        monkeypatch.setattr(http_api_module, "Path", PatchedPath)

        response = api_client.get("/api/classifiers/dhcp/baseline")
        assert response.status_code == 200
        data = response.json()
        assert data["classifier"] == "dhcp"
        assert len(data["hourly_distributions"]) == 24
