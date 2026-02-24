"""
Tests for FD-013: Include classifiers in realtime WebSocket metric messages.

Tests:
- WebSocket metric messages include classifiers when present
- Message shape remains backward compatible
"""
import pytest
import asyncio
import json
from unittest.mock import Mock, AsyncMock, patch


class TestWebSocketMetricMessagesWithClassifiers:
    """Tests for WebSocket broadcasts including classifier data."""
    
    @pytest.mark.asyncio
    async def test_websocket_metric_message_includes_classifiers(self):
        """WebSocket broadcast should include classifiers when present in observation."""
        from server.websocket_server import WebSocketServer
        
        # Create server
        ws_server = WebSocketServer()
        
        # Mock a connected client
        mock_client = AsyncMock()
        ws_server.clients.add(mock_client)
        
        # Observation with classifiers
        observation = {
            "timestamp": 1234567890,
            "metric": "successful_connects",
            "value": 95.5,
            "entity": None,
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
        
        # Broadcast the observation
        await ws_server.broadcast_metric(observation)
        
        # Verify message was sent
        assert mock_client.send.called
        sent_message = mock_client.send.call_args[0][0]
        
        # Parse the message
        data = json.loads(sent_message)
        
        # Verify structure
        assert data["type"] == "metric"
        assert data["timestamp"] == 1234567890
        assert data["metric"] == "successful_connects"
        assert data["value"] == 95.5
        
        # Verify classifiers are included
        assert "classifiers" in data
        assert len(data["classifiers"]) == 2
        assert data["classifiers"][0]["name"] == "dhcp"
        assert data["classifiers"][0]["value"] == 98.0
        assert data["classifiers"][0]["status"] == "green"
        assert data["classifiers"][1]["name"] == "dns"
    
    @pytest.mark.asyncio
    async def test_websocket_message_shape_backward_compatible(self):
        """WebSocket broadcast should work without classifiers (backward compatibility)."""
        from server.websocket_server import WebSocketServer
        
        # Create server
        ws_server = WebSocketServer()
        
        # Mock a connected client
        mock_client = AsyncMock()
        ws_server.clients.add(mock_client)
        
        # Observation without classifiers (legacy format)
        observation = {
            "timestamp": 1234567890,
            "metric": "throughput",
            "value": 125.3,
            "entity": None
        }
        
        # Broadcast the observation
        await ws_server.broadcast_metric(observation)
        
        # Verify message was sent
        assert mock_client.send.called
        sent_message = mock_client.send.call_args[0][0]
        
        # Parse the message
        data = json.loads(sent_message)
        
        # Verify structure
        assert data["type"] == "metric"
        assert data["timestamp"] == 1234567890
        assert data["metric"] == "throughput"
        assert data["value"] == 125.3
        
        # Classifiers should not be present or should be None/absent
        classifiers = data.get("classifiers")
        assert classifiers is None or classifiers == []
    
    @pytest.mark.asyncio
    async def test_event_messages_unchanged(self):
        """Event messages should remain unchanged (no classifiers in events)."""
        from server.websocket_server import WebSocketServer
        
        # Create server
        ws_server = WebSocketServer()
        
        # Mock a connected client
        mock_client = AsyncMock()
        ws_server.clients.add(mock_client)
        
        # Event message
        event = {
            "timestamp": 1234567890,
            "event_type": "network_issue",
            "severity": "warning",
            "entity": "AP-Floor1-01",
            "message": "High interference detected"
        }
        
        # Broadcast the event
        await ws_server.broadcast_event(event)
        
        # Verify message was sent
        assert mock_client.send.called
        sent_message = mock_client.send.call_args[0][0]
        
        # Parse the message
        data = json.loads(sent_message)
        
        # Verify structure (no classifiers field)
        assert data["type"] == "event"
        assert data["event_type"] == "network_issue"
        assert data["severity"] == "warning"
        assert "classifiers" not in data


class TestGeneratorObservationWithClassifiers:
    """Tests for generator including classifiers in observations."""
    
    def test_generate_observation_includes_classifiers(
        self, 
        seeded_generator,
        fixed_timestamp
    ):
        """RealisticMetricsGenerator should include classifiers in observations when requested."""
        generator = seeded_generator
        
        # Generate observation for a composite metric
        observation = generator.generate_observation(
            metric="successful_connects",
            timestamp=fixed_timestamp,
            include_classifiers=True
        )
        
        # Verify observation has classifiers
        assert "classifiers" in observation
        assert observation["classifiers"] is not None
        assert isinstance(observation["classifiers"], list)
        assert len(observation["classifiers"]) > 0
        
        # Verify classifier structure
        classifier = observation["classifiers"][0]
        assert "name" in classifier
        assert "value" in classifier
        assert "status" in classifier
        assert "contribution" in classifier
        
        # Status should be one of green/yellow/red
        assert classifier["status"] in ["green", "yellow", "red"]
    
    def test_generate_observation_classifiers_optional(
        self,
        seeded_generator,
        fixed_timestamp
    ):
        """Classifiers should be optional (default behavior unchanged)."""
        generator = seeded_generator
        
        # Generate observation without classifiers flag (default)
        observation = generator.generate_observation(
            metric="throughput",
            timestamp=fixed_timestamp
        )
        
        # By default, classifiers should not be included
        assert "classifiers" not in observation or observation.get("classifiers") is None
    
    def test_generate_observation_classifiers_for_all_metrics(
        self,
        seeded_generator,
        fixed_timestamp
    ):
        """All metrics should support classifier breakdown."""
        generator = seeded_generator
        
        # Test for each metric
        for metric in generator.get_all_metrics():
            observation = generator.generate_observation(
                metric=metric,
                timestamp=fixed_timestamp,
                include_classifiers=True
            )
            
            # Each should have classifiers
            assert "classifiers" in observation
            assert observation["classifiers"] is not None
            assert len(observation["classifiers"]) > 0
