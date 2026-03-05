"""
Tests for Phase 1: Failure Reason Codes on Events.

Verifies that:
- Failure code constants match production taxonomy (from successful-connects.ts)
- Connection-failure events include structured reason codes in metadata
- Non-connection events are unchanged
- Existing perturbation/event behavior is preserved
"""
import pytest
from simulator.event_generator import (
    EventGenerator,
    DHCP_FAILURE_REASONS,
    AUTH_FAILURE_REASONS,
    DNS_FAILURE_REASONS,
    ASSOC_FAILURE_REASONS,
)
from simulator.perturbations import create_perturbation_from_event


# ---------------------------------------------------------------------------
# TestFailureReasonCodeTaxonomy
# ---------------------------------------------------------------------------

class TestFailureReasonCodeTaxonomy:
    """Verify the failure code constants match production values."""

    def test_dhcp_failure_codes_exist(self):
        assert isinstance(DHCP_FAILURE_REASONS, list)
        codes = [r["code"] for r in DHCP_FAILURE_REASONS]
        for expected_code in [108, 109, 110, 112]:
            assert expected_code in codes, f"DHCP code {expected_code} not found"
        for r in DHCP_FAILURE_REASONS:
            assert r["type"] == "Meraki reason"

    def test_auth_failure_codes_exist(self):
        codes = {r["code"]: r["type"] for r in AUTH_FAILURE_REASONS}
        assert 102 in codes and codes[102] == "Meraki reason"
        assert 103 in codes and codes[103] == "Meraki reason"
        assert 15 in codes and codes[15] == "802.11 reason"

    def test_dns_failure_codes_exist(self):
        codes = [r["code"] for r in DNS_FAILURE_REASONS]
        assert 114 in codes
        assert 115 in codes
        for r in DNS_FAILURE_REASONS:
            assert r["type"] == "Meraki reason"

    def test_assoc_failure_codes_exist(self):
        types_codes = {r["code"]: r["type"] for r in ASSOC_FAILURE_REASONS}
        assert 0 in types_codes and types_codes[0] == "802.11 status"
        assert 1 in types_codes and types_codes[1] == "802.11 reason"

    def test_all_reason_codes_have_required_fields(self):
        all_pools = [
            DHCP_FAILURE_REASONS,
            AUTH_FAILURE_REASONS,
            DNS_FAILURE_REASONS,
            ASSOC_FAILURE_REASONS,
        ]
        for pool in all_pools:
            for r in pool:
                assert set(r.keys()) >= {"type", "code", "reason"}
                assert isinstance(r["code"], int)
                assert isinstance(r["type"], str) and r["type"]
                assert isinstance(r["reason"], str) and r["reason"]


# ---------------------------------------------------------------------------
# TestEventMetadataIncludesFailureCodes
# ---------------------------------------------------------------------------

class TestEventMetadataIncludesFailureCodes:
    """Events for connection-related failures include structured reason codes."""

    @pytest.fixture
    def gen(self):
        return EventGenerator(config_path="simulator/config.json")

    def test_dhcp_overload_event_has_failure_reasons(self, gen):
        event = gen.generate_event("dhcp_server_overload", register_perturbation=False)
        meta = event["metadata"]
        assert "failure_reasons" in meta, "Expected failure_reasons key in metadata"
        reasons = meta["failure_reasons"]
        assert isinstance(reasons, list) and len(reasons) >= 1
        valid_codes = {108, 109, 110, 112}
        for entry in reasons:
            assert {"type", "code", "reason", "count"} <= set(entry.keys())
            assert entry["code"] in valid_codes

    def test_radius_timeout_event_has_failure_reasons(self, gen):
        event = gen.generate_event("radius_timeout", register_perturbation=False)
        meta = event["metadata"]
        assert "failure_reasons" in meta
        valid_codes = {102, 103, 15}
        for entry in meta["failure_reasons"]:
            assert entry["code"] in valid_codes

    def test_dns_failure_event_has_failure_reasons(self, gen):
        event = gen.generate_event("dns_resolution_failure", register_perturbation=False)
        meta = event["metadata"]
        assert "failure_reasons" in meta
        valid_codes = {114, 115}
        for entry in meta["failure_reasons"]:
            assert entry["code"] in valid_codes

    def test_non_connection_events_unchanged(self, gen):
        for event_type in ["device_restart", "config_change", "ai_action"]:
            event = gen.generate_event(event_type, register_perturbation=False)
            meta = event["metadata"]
            assert "failure_reasons" not in meta, (
                f"{event_type} should NOT have failure_reasons"
            )
            # Standard metadata keys are preserved
            assert isinstance(meta, dict)

    def test_failure_reason_counts_are_positive_integers(self, gen):
        for event_type in ["dhcp_server_overload", "radius_timeout", "dns_resolution_failure"]:
            event = gen.generate_event(event_type, register_perturbation=False)
            for entry in event["metadata"]["failure_reasons"]:
                assert isinstance(entry["count"], int) and entry["count"] > 0

    def test_failure_contributor_and_sub_contributor_present(self, gen):
        event = gen.generate_event("dhcp_server_overload", register_perturbation=False)
        meta = event["metadata"]
        assert "contributor" in meta
        assert meta["contributor"] == "dhcp"
        assert "sub_contributor" in meta
        assert isinstance(meta["sub_contributor"], str) and meta["sub_contributor"]


# ---------------------------------------------------------------------------
# TestFailureCodeRegressions
# ---------------------------------------------------------------------------

class TestFailureCodeRegressions:
    """Existing event behavior is preserved."""

    @pytest.fixture
    def gen(self):
        return EventGenerator(config_path="simulator/config.json")

    def test_all_existing_event_types_still_generate(self, gen):
        for event_type in EventGenerator.EVENT_TYPES:
            event = gen.generate_event(event_type, register_perturbation=False)
            assert event["event_type"] == event_type
            for key in ["timestamp", "event_type", "severity", "entity", "message", "metadata"]:
                assert key in event, f"Missing key '{key}' in {event_type} event"

    def test_perturbation_creation_unchanged(self, gen):
        connection_types = ["dhcp_server_overload", "radius_timeout", "dns_resolution_failure"]
        for event_type in connection_types:
            event = gen.generate_event(event_type, register_perturbation=False)
            perturbation = create_perturbation_from_event(event)
            assert perturbation is not None, f"Expected perturbation for {event_type}"
