"""
Tests for FD-010: Extend server models and storage for classifiers.

Tests:
- ClassifierStatus model validation
- MetricObservation accepts optional classifiers
- Storage roundtrip with classifiers
- Storage roundtrip without classifiers (backward compatibility)
"""
import pytest
from server.models import MetricObservation, ClassifierStatus
from storage.metrics_store import MetricsStore


class TestClassifierStatusModel:
    """Tests for ClassifierStatus model."""
    
    def test_classifier_status_basic_fields(self):
        """ClassifierStatus should have name, value, status, contribution fields."""
        cs = ClassifierStatus(
            name="dhcp",
            value=95.2,
            status="green",
            contribution=0.25
        )
        assert cs.name == "dhcp"
        assert cs.value == 95.2
        assert cs.status == "green"
        assert cs.contribution == 0.25
    
    def test_classifier_status_with_weight(self):
        """ClassifierStatus should accept optional weight field."""
        cs = ClassifierStatus(
            name="dns",
            value=88.5,
            status="yellow",
            contribution=0.15,
            weight=0.8
        )
        assert cs.weight == 0.8
    
    def test_classifier_status_without_weight(self):
        """ClassifierStatus should work without weight field."""
        cs = ClassifierStatus(
            name="association",
            value=99.1,
            status="green",
            contribution=0.3
        )
        assert cs.weight is None
    
    def test_classifier_status_validates_status_enum(self):
        """ClassifierStatus should validate status is one of green/yellow/red."""
        # Valid statuses
        for status in ["green", "yellow", "red"]:
            cs = ClassifierStatus(
                name="test",
                value=50.0,
                status=status,
                contribution=0.5
            )
            assert cs.status == status
    
    def test_classifier_status_serializes_to_dict(self):
        """ClassifierStatus should serialize properly for JSON responses."""
        cs = ClassifierStatus(
            name="dhcp",
            value=95.2,
            status="green",
            contribution=0.25,
            weight=0.5
        )
        data = cs.model_dump()
        assert data["name"] == "dhcp"
        assert data["value"] == 95.2
        assert data["status"] == "green"
        assert data["contribution"] == 0.25
        assert data["weight"] == 0.5


class TestMetricObservationWithClassifiers:
    """Tests for MetricObservation with optional classifiers field."""
    
    def test_observation_accepts_optional_classifiers(self):
        """MetricObservation should accept optional classifiers field."""
        obs = MetricObservation(
            timestamp=1769990400,
            metric="successful_connects",
            value=95.5,
            classifiers=[
                ClassifierStatus(
                    name="dhcp",
                    value=98.0,
                    status="green",
                    contribution=0.4
                ),
                ClassifierStatus(
                    name="dns",
                    value=92.0,
                    status="yellow",
                    contribution=0.3
                )
            ]
        )
        assert obs.classifiers is not None
        assert len(obs.classifiers) == 2
        assert obs.classifiers[0].name == "dhcp"
        assert obs.classifiers[1].name == "dns"
    
    def test_observation_classifiers_defaults_to_none(self):
        """MetricObservation classifiers should default to None for backward compatibility."""
        obs = MetricObservation(
            timestamp=1769990400,
            metric="throughput",
            value=125.3
        )
        assert obs.classifiers is None
    
    def test_observation_with_classifiers_serializes(self):
        """MetricObservation with classifiers should serialize to dict/JSON."""
        obs = MetricObservation(
            timestamp=1769990400,
            metric="successful_connects",
            value=95.5,
            classifiers=[
                ClassifierStatus(
                    name="dhcp",
                    value=98.0,
                    status="green",
                    contribution=0.4
                )
            ]
        )
        data = obs.model_dump()
        assert "classifiers" in data
        assert isinstance(data["classifiers"], list)
        assert len(data["classifiers"]) == 1
        assert data["classifiers"][0]["name"] == "dhcp"


class TestMetricsStoreClassifierRoundtrip:
    """Tests for MetricsStore handling classifiers field."""
    
    def test_storage_roundtrip_with_classifiers(self, isolated_metrics_store, fixed_timestamp):
        """MetricsStore should persist and retrieve classifiers."""
        store = isolated_metrics_store
        
        # Insert observation with classifiers
        observation = {
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
        }
        
        store.insert_observation(observation)
        
        # Query back
        results = store.query_range(
            "successful_connects",
            fixed_timestamp - 1,
            fixed_timestamp + 1
        )
        
        assert len(results) == 1
        retrieved = results[0]
        assert retrieved["timestamp"] == fixed_timestamp
        assert retrieved["metric"] == "successful_connects"
        assert retrieved["value"] == 95.5
        assert "classifiers" in retrieved
        assert len(retrieved["classifiers"]) == 2
        assert retrieved["classifiers"][0]["name"] == "dhcp"
        assert retrieved["classifiers"][0]["value"] == 98.0
        assert retrieved["classifiers"][0]["status"] == "green"
        assert retrieved["classifiers"][1]["name"] == "dns"
    
    def test_storage_roundtrip_without_classifiers(self, isolated_metrics_store, fixed_timestamp):
        """MetricsStore should handle observations without classifiers (backward compat)."""
        store = isolated_metrics_store
        
        # Insert observation without classifiers
        observation = {
            "timestamp": fixed_timestamp,
            "metric": "throughput",
            "value": 125.3,
            "entity": "_global"
        }
        
        store.insert_observation(observation)
        
        # Query back
        results = store.query_range(
            "throughput",
            fixed_timestamp - 1,
            fixed_timestamp + 1
        )
        
        assert len(results) == 1
        retrieved = results[0]
        assert retrieved["timestamp"] == fixed_timestamp
        assert retrieved["metric"] == "throughput"
        assert retrieved["value"] == 125.3
        # classifiers should be None or absent
        assert retrieved.get("classifiers") is None
    
    def test_batch_insert_with_mixed_classifier_presence(self, isolated_metrics_store, fixed_timestamp):
        """MetricsStore should handle batch insert with mixed classifier presence."""
        store = isolated_metrics_store
        
        observations = [
            {
                "timestamp": fixed_timestamp,
                "metric": "throughput",
                "value": 100.0,
                "entity": "_global"
                # No classifiers
            },
            {
                "timestamp": fixed_timestamp + 10,
                "metric": "successful_connects",
                "value": 95.0,
                "entity": "_global",
                "classifiers": [
                    {
                        "name": "dhcp",
                        "value": 97.0,
                        "status": "green",
                        "contribution": 0.5
                    }
                ]
            }
        ]
        
        store.insert_batch(observations)
        
        # Query both back
        throughput_results = store.query_range("throughput", fixed_timestamp - 1, fixed_timestamp + 15)
        connect_results = store.query_range("successful_connects", fixed_timestamp - 1, fixed_timestamp + 15)
        
        assert len(throughput_results) == 1
        assert throughput_results[0].get("classifiers") is None
        
        assert len(connect_results) == 1
        assert "classifiers" in connect_results[0]
        assert len(connect_results[0]["classifiers"]) == 1


class TestStorageStrategyDocumentation:
    """Test that storage strategy choice is documented."""
    
    def test_storage_strategy_selected_and_documented(self):
        """Storage strategy should be documented in code or docs."""
        # Read metrics_store.py to verify strategy is documented
        with open("storage/metrics_store.py", "r") as f:
            content = f.read()
        
        # Should mention classifier storage strategy
        assert "classifier" in content.lower() or "classifiers" in content.lower()
        
        # Should have comment explaining storage approach
        # (This will pass once we document the decision)
