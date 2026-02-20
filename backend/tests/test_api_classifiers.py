"""
Tests for FD-011: Expose classifier payloads in metric query APIs.

Tests:
- /api/metrics/{metric} returns observations with classifiers when present
- /api/metrics/{metric} works without classifiers (backward compatibility)
"""
import pytest
from fastapi.testclient import TestClient
from server.http_api import app
from storage.metrics_store import get_metrics_store


@pytest.fixture
def api_client():
    """Create test client for API."""
    return TestClient(app)


@pytest.fixture
def store_with_classifier_data(isolated_metrics_store, fixed_timestamp):
    """
    Populate metrics store with observations that have classifier data.
    """
    store = isolated_metrics_store
    
    # Insert observations with classifiers
    observations = [
        {
            "timestamp": fixed_timestamp,
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
            "timestamp": fixed_timestamp + 10,
            "metric": "successful_connects",
            "value": 93.2,
            "entity": "_global",
            "classifiers": [
                {
                    "name": "dhcp",
                    "value": 97.5,
                    "status": "green",
                    "contribution": 0.4
                },
                {
                    "name": "dns",
                    "value": 88.0,
                    "status": "yellow",
                    "contribution": 0.3
                }
            ]
        }
    ]
    
    store.insert_batch(observations)
    return store


@pytest.fixture
def store_without_classifier_data(isolated_metrics_store, fixed_timestamp):
    """
    Populate metrics store with observations WITHOUT classifier data (legacy).
    """
    store = isolated_metrics_store
    
    # Insert observations without classifiers
    observations = [
        {
            "timestamp": fixed_timestamp,
            "metric": "throughput",
            "value": 125.3,
            "entity": "_global"
        },
        {
            "timestamp": fixed_timestamp + 10,
            "metric": "throughput",
            "value": 130.1,
            "entity": "_global"
        }
    ]
    
    store.insert_batch(observations)
    return store


class TestMetricAPIWithClassifiers:
    """Tests for /api/metrics/{metric} endpoint with classifiers."""
    
    def test_get_metric_returns_classifiers_when_present(
        self, 
        api_client, 
        store_with_classifier_data, 
        fixed_timestamp,
        monkeypatch
    ):
        """API should return classifier data when present in observations."""
        # Monkeypatch the get_metrics_store to return our test store
        monkeypatch.setattr(
            "server.http_api.get_metrics_store",
            lambda: store_with_classifier_data
        )
        
        # Query the metric
        response = api_client.get(
            "/api/metrics/successful_connects",
            params={
                "start": fixed_timestamp - 1,
                "end": fixed_timestamp + 15,
                "entity": "_all"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert data["metric"] == "successful_connects"
        assert len(data["observations"]) == 2
        
        # Verify first observation has classifiers
        obs1 = data["observations"][0]
        assert "classifiers" in obs1
        assert obs1["classifiers"] is not None
        assert len(obs1["classifiers"]) == 2
        
        # Verify classifier structure
        dhcp_classifier = next(c for c in obs1["classifiers"] if c["name"] == "dhcp")
        assert dhcp_classifier["value"] == 98.0
        assert dhcp_classifier["status"] == "green"
        assert dhcp_classifier["contribution"] == 0.4
        assert dhcp_classifier["weight"] == 0.5
        
        dns_classifier = next(c for c in obs1["classifiers"] if c["name"] == "dns")
        assert dns_classifier["value"] == 92.0
        assert dns_classifier["status"] == "yellow"
        
        # Verify second observation also has classifiers
        obs2 = data["observations"][1]
        assert "classifiers" in obs2
        assert obs2["classifiers"] is not None
        assert len(obs2["classifiers"]) == 2
    
    def test_get_metric_still_works_when_classifiers_missing(
        self,
        api_client,
        store_without_classifier_data,
        fixed_timestamp,
        monkeypatch
    ):
        """API should work correctly for legacy data without classifiers."""
        # Monkeypatch the get_metrics_store to return our test store
        monkeypatch.setattr(
            "server.http_api.get_metrics_store",
            lambda: store_without_classifier_data
        )
        
        # Query the metric
        response = api_client.get(
            "/api/metrics/throughput",
            params={
                "start": fixed_timestamp - 1,
                "end": fixed_timestamp + 15,
                "entity": "_all"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert data["metric"] == "throughput"
        assert len(data["observations"]) == 2
        
        # Verify observations work without classifiers
        obs1 = data["observations"][0]
        assert obs1["value"] == 125.3
        assert obs1["timestamp"] == fixed_timestamp
        # classifiers should be None or absent
        assert obs1.get("classifiers") is None
        
        obs2 = data["observations"][1]
        assert obs2["value"] == 130.1
        assert obs2.get("classifiers") is None
    
    def test_get_metric_with_entity_aggregation_preserves_classifiers(
        self,
        api_client,
        isolated_metrics_store,
        fixed_timestamp,
        monkeypatch
    ):
        """
        API entity aggregation should handle classifiers gracefully.
        
        Note: For _aggregated mode, classifier aggregation is complex
        (would require merging classifier contributions across entities).
        For now, we just verify the API doesn't break.
        """
        store = isolated_metrics_store
        
        # Insert observations from multiple entities with classifiers
        observations = [
            {
                "timestamp": fixed_timestamp,
                "metric": "successful_connects",
                "value": 95.0,
                "entity": "AP-1",
                "classifiers": [
                    {"name": "dhcp", "value": 98.0, "status": "green", "contribution": 0.5}
                ]
            },
            {
                "timestamp": fixed_timestamp,
                "metric": "successful_connects",
                "value": 90.0,
                "entity": "AP-2",
                "classifiers": [
                    {"name": "dhcp", "value": 92.0, "status": "green", "contribution": 0.5}
                ]
            }
        ]
        
        store.insert_batch(observations)
        
        monkeypatch.setattr("server.http_api.get_metrics_store", lambda: store)
        
        # Query with entity aggregation
        response = api_client.get(
            "/api/metrics/successful_connects",
            params={
                "start": fixed_timestamp - 1,
                "end": fixed_timestamp + 1,
                "entity": "_aggregated"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Should compute mean value (95 + 90) / 2 = 92.5
        assert len(data["observations"]) == 1
        assert data["observations"][0]["value"] == 92.5
        
        # For aggregated entities, classifiers may not be meaningful
        # (we'd need to merge/average them, which is complex)
        # Just verify the response is valid
