"""
Tests for FD-012: Add classifier-specific API endpoints.

Tests:
- GET /api/metrics/{metric}/classifiers/current - current classifier state
- GET /api/classifiers/{classifier}/baseline - classifier baseline distributions
- Invalid metric/classifier returns 404
"""
import json
import time

import pytest
from fastapi.testclient import TestClient
from server.http_api import app
from storage.metrics_store import get_metrics_store
from simulator.baseline_artifact import build_baseline_metadata
from simulator.realistic_generator import CLASSIFIER_DEFINITIONS


@pytest.fixture
def api_client():
    """Create test client for API."""
    return TestClient(app)


@pytest.fixture(autouse=True)
def valid_baseline_artifact(tmp_path, monkeypatch):
    """Give endpoint tests an isolated, compatible baseline artifact."""

    now = int(time.time())
    distribution = {
        "p1": 0.90,
        "p5": 0.92,
        "p10": 0.94,
        "p25": 0.96,
        "p50": 0.98,
        "p75": 0.99,
        "p90": 0.995,
        "p95": 0.998,
        "p99": 0.999,
        "mean": 0.975,
        "stddev": 0.02,
    }
    artifact = {
        **build_baseline_metadata(
            generated_at=now,
            n_aps=1,
            ap_list=["AP-Floor1-01"],
            lookback_days=30,
        ),
        "classifiers": {
            name: [
                {
                    "hour": hour,
                    "distribution": distribution,
                    "sample_count": 100,
                }
                for hour in range(24)
            ]
            for name in CLASSIFIER_DEFINITIONS
        },
        "metrics": {},
    }
    path = tmp_path / "baselines.json"
    path.write_text(json.dumps(artifact))
    monkeypatch.setattr("server.http_api.get_baseline_path", lambda: path)


@pytest.fixture
def store_with_recent_classifiers(isolated_metrics_store, fixed_timestamp):
    """
    Populate metrics store with recent observations that have classifier data.
    """
    store = isolated_metrics_store
    
    # Insert observations with classifiers at different times
    observations = [
        {
            "timestamp": fixed_timestamp - 100,
            "metric": "successful_connects",
            "value": 94.0,
            "entity": "_global",
            "classifiers": [
                {
                    "name": "dhcp",
                    "value": 97.0,
                    "status": "green",
                    "contribution": 0.4,
                    "weight": 0.5
                },
                {
                    "name": "dns",
                    "value": 91.0,
                    "status": "yellow",
                    "contribution": 0.3,
                    "weight": 0.3
                }
            ]
        },
        {
            "timestamp": fixed_timestamp - 50,
            "metric": "successful_connects",
            "value": 95.5,
            "entity": "_global",
            "classifiers": [
                {
                    "name": "dhcp",
                    "value": 98.0,
                    "status": "green",
                    "contribution": 0.4,
                    "weight": 0.5
                },
                {
                    "name": "dns",
                    "value": 92.0,
                    "status": "yellow",
                    "contribution": 0.3,
                    "weight": 0.3
                }
            ]
        },
        {
            "timestamp": fixed_timestamp,  # Most recent
            "metric": "successful_connects",
            "value": 96.2,
            "entity": "_global",
            "classifiers": [
                {
                    "name": "dhcp",
                    "value": 99.0,
                    "status": "green",
                    "contribution": 0.4,
                    "weight": 0.5
                },
                {
                    "name": "dns",
                    "value": 93.0,
                    "status": "green",
                    "contribution": 0.3,
                    "weight": 0.3
                },
                {
                    "name": "association",
                    "value": 98.5,
                    "status": "green",
                    "contribution": 0.2,
                    "weight": 0.2
                }
            ]
        }
    ]
    
    store.insert_batch(observations)
    return store


class TestCurrentClassifierStateEndpoint:
    """Tests for /api/metrics/{metric}/classifiers/current endpoint."""
    
    def test_get_metric_classifiers_current_state(
        self,
        api_client,
        store_with_recent_classifiers,
        monkeypatch
    ):
        """Should return current classifier breakdown for a metric."""
        monkeypatch.setattr(
            "server.http_api.get_metrics_store",
            lambda: store_with_recent_classifiers
        )
        
        response = api_client.get("/api/metrics/successful_connects/classifiers/current")
        
        assert response.status_code == 200
        data = response.json()
        
        # Should have metric and timestamp
        assert data["metric"] == "successful_connects"
        assert "timestamp" in data
        assert "value" in data
        
        # Should have classifiers list
        assert "classifiers" in data
        assert len(data["classifiers"]) == 3  # Most recent observation has 3
        
        # Verify it's the most recent data (dhcp=99.0, dns=93.0)
        dhcp = next(c for c in data["classifiers"] if c["name"] == "dhcp")
        assert dhcp["value"] == 99.0
        assert dhcp["status"] == "green"
        assert dhcp["contribution"] == 0.4
        
        dns = next(c for c in data["classifiers"] if c["name"] == "dns")
        assert dns["value"] == 93.0
        assert dns["status"] == "green"
        
        association = next(c for c in data["classifiers"] if c["name"] == "association")
        assert association["value"] == 98.5
    
    def test_get_classifiers_for_invalid_metric_returns_404(self, api_client):
        """Should return 404 for non-existent metric."""
        response = api_client.get("/api/metrics/nonexistent_metric/classifiers/current")
        
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    
    def test_get_classifiers_when_no_data_returns_404(
        self,
        api_client,
        isolated_metrics_store,
        monkeypatch
    ):
        """Should return 404 when metric has no observations."""
        monkeypatch.setattr(
            "server.http_api.get_metrics_store",
            lambda: isolated_metrics_store
        )
        
        # Query valid metric but with no data in store
        response = api_client.get("/api/metrics/throughput/classifiers/current")
        
        assert response.status_code == 404
        assert "no data" in response.json()["detail"].lower()


class TestClassifierBaselineEndpoint:
    """Tests for /api/classifiers/{classifier}/baseline endpoint."""
    
    def test_get_classifier_baseline(self, api_client):
        """Should return hourly baseline distributions for a classifier."""
        response = api_client.get("/api/classifiers/dhcp/baseline")
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify structure
        assert data["classifier"] == "dhcp"
        assert "lookback_days" in data
        assert "hourly_distributions" in data
        
        # Should have 24 hourly distributions
        assert len(data["hourly_distributions"]) == 24
        
        # Verify each hour has expected structure
        for hourly in data["hourly_distributions"]:
            assert "hour" in hourly
            assert 0 <= hourly["hour"] <= 23
            assert "distribution" in hourly
            assert "sample_count" in hourly
            
            # Distribution should have percentiles
            dist = hourly["distribution"]
            assert "p1" in dist
            assert "p5" in dist
            assert "p10" in dist
            assert "p50" in dist
            assert "p95" in dist
            assert "p99" in dist
            assert "mean" in dist
            assert "stddev" in dist
    
    def test_get_classifier_baseline_for_all_classifiers(self, api_client):
        """Should work for all known classifiers."""
        classifiers = [
            "association", "authorization", "dhcp", "dns",
            "client_density", "cochannel_interference", "nonwifi_interference",
            "airtime_utilization", "channel_width", "retry_rate"
        ]
        
        for classifier in classifiers:
            response = api_client.get(f"/api/classifiers/{classifier}/baseline")
            assert response.status_code == 200, f"Failed for {classifier}"
            data = response.json()
            assert data["classifier"] == classifier
            assert len(data["hourly_distributions"]) == 24
    
    def test_get_baseline_for_invalid_classifier_returns_404(self, api_client):
        """Should return 404 for non-existent classifier."""
        response = api_client.get("/api/classifiers/nonexistent_classifier/baseline")
        
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()
    
    def test_classifier_baseline_hours_ordered(self, api_client):
        """Hourly distributions should be in order 0-23."""
        response = api_client.get("/api/classifiers/dns/baseline")
        
        assert response.status_code == 200
        data = response.json()
        
        hours = [h["hour"] for h in data["hourly_distributions"]]
        assert hours == list(range(24))
    
    def test_classifier_baseline_values_realistic(self, api_client):
        """Classifier values should be in realistic ranges."""
        response = api_client.get("/api/classifiers/association/baseline")
        
        assert response.status_code == 200
        data = response.json()
        
        # Association is a success rate, should be 0-1 (or 0-100 if percentage)
        for hourly in data["hourly_distributions"]:
            dist = hourly["distribution"]
            # Check all percentiles are in valid range
            for key in ["p1", "p5", "p10", "p50", "p95", "p99", "mean"]:
                value = dist[key]
                # Assuming success rates are 0-1 fractional
                assert 0.0 <= value <= 1.0, f"Hour {hourly['hour']} {key}={value} out of range"
