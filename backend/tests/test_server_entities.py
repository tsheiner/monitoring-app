"""
Tests for Phase 3: Named Server Entities.

Verifies that:
- Config files have a servers section with dns/dhcp/radius sub-keys
- Each server has ip, base_success_rate, latency_ms_range
- Connection-failure events reference a specific server
- Legacy config (no servers) doesn't break event generation
"""
import json
import re
import pytest
from pathlib import Path


IPV4_REGEX = re.compile(
    r'^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$'
)


def _load_config(filename):
    path = Path("simulator") / filename
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# TestServerConfigSchema
# ---------------------------------------------------------------------------

class TestServerConfigSchema:
    """Config files define named server infrastructure."""

    @pytest.mark.parametrize("filename", [
        "config_enterprise.json",
        "config_campus.json",
        "config_hospital.json",
    ])
    def test_config_has_servers_section(self, filename):
        cfg = _load_config(filename)
        assert "servers" in cfg, f"{filename} missing 'servers' section"
        servers = cfg["servers"]
        for key in ["dns", "dhcp", "radius"]:
            assert key in servers, f"{filename} servers section missing '{key}'"

    @pytest.mark.parametrize("filename", [
        "config_enterprise.json",
        "config_campus.json",
        "config_hospital.json",
    ])
    def test_each_server_has_required_fields(self, filename):
        cfg = _load_config(filename)
        for server_type, server_list in cfg["servers"].items():
            for entry in server_list:
                assert "ip" in entry, f"{filename} {server_type} server missing 'ip'"
                assert "base_success_rate" in entry
                assert "latency_ms_range" in entry
                assert IPV4_REGEX.match(entry["ip"]), (
                    f"{filename} {server_type} ip '{entry['ip']}' not valid IPv4"
                )
                rate = entry["base_success_rate"]
                assert 0.0 <= rate <= 1.0, (
                    f"{filename} {server_type} base_success_rate {rate} out of [0,1]"
                )
                lat = entry["latency_ms_range"]
                assert isinstance(lat, list) and len(lat) == 2 and lat[0] < lat[1]

    @pytest.mark.parametrize("filename", [
        "config_enterprise.json",
        "config_campus.json",
        "config_hospital.json",
    ])
    def test_dns_servers_present(self, filename):
        cfg = _load_config(filename)
        dns_servers = cfg["servers"]["dns"]
        assert len(dns_servers) >= 2
        ips = [s["ip"] for s in dns_servers]
        # At least one external
        external = [ip for ip in ips if ip.startswith("8.8") or ip.startswith("1.1")]
        assert external, f"{filename} DNS servers must include at least one external"
        # At least one internal
        internal = [ip for ip in ips if ip.startswith("10.") or ip.startswith("172.")]
        assert internal, f"{filename} DNS servers must include at least one internal"

    @pytest.mark.parametrize("filename", [
        "config_enterprise.json",
        "config_campus.json",
        "config_hospital.json",
    ])
    def test_dhcp_servers_present(self, filename):
        cfg = _load_config(filename)
        dhcp_servers = cfg["servers"]["dhcp"]
        assert len(dhcp_servers) >= 1
        for s in dhcp_servers:
            ip = s["ip"]
            # Must be in private range
            is_private = (
                ip.startswith("10.") or
                ip.startswith("172.") or
                ip.startswith("192.168.")
            )
            assert is_private, f"{filename} DHCP ip '{ip}' should be in private range"

    @pytest.mark.parametrize("filename", [
        "config_enterprise.json",
        "config_campus.json",
        "config_hospital.json",
    ])
    def test_radius_servers_present(self, filename):
        cfg = _load_config(filename)
        assert len(cfg["servers"]["radius"]) >= 1

    @pytest.mark.parametrize("filename,server_type,expected_range", [
        ("config_enterprise.json", "dhcp",   (0.85, 0.95)),
        ("config_enterprise.json", "dns",    (0.85, 0.98)),
        ("config_enterprise.json", "radius", (0.95, 0.99)),
    ])
    def test_server_success_rates_match_production_ranges(
        self, filename, server_type, expected_range
    ):
        cfg = _load_config(filename)
        for s in cfg["servers"][server_type]:
            rate = s["base_success_rate"]
            lo, hi = expected_range
            assert lo <= rate <= hi, (
                f"{filename} {server_type} rate {rate} not in [{lo},{hi}]"
            )


# ---------------------------------------------------------------------------
# TestServerReferencesInEvents
# ---------------------------------------------------------------------------

class TestServerReferencesInEvents:
    """Connection-failure events reference a specific server."""

    @pytest.fixture
    def gen(self):
        from simulator.event_generator import EventGenerator
        return EventGenerator(config_path="simulator/config_enterprise.json")

    def _get_all_configured_ips(self, server_type):
        cfg = _load_config("config_enterprise.json")
        return {s["ip"] for s in cfg["servers"][server_type]}

    def test_dhcp_overload_event_identifies_server(self, gen):
        event = gen.generate_event("dhcp_server_overload", register_perturbation=False)
        meta = event["metadata"]
        assert "server" in meta, "Expected 'server' key in dhcp_server_overload metadata"
        assert meta["server"]["type"] == "dhcp"
        assert IPV4_REGEX.match(meta["server"]["ip"])

    def test_radius_timeout_event_identifies_server(self, gen):
        event = gen.generate_event("radius_timeout", register_perturbation=False)
        assert event["metadata"]["server"]["type"] == "radius"

    def test_dns_failure_event_identifies_server(self, gen):
        event = gen.generate_event("dns_resolution_failure", register_perturbation=False)
        assert event["metadata"]["server"]["type"] == "dns"

    def test_server_selection_is_from_config(self, gen):
        dhcp_ips = self._get_all_configured_ips("dhcp")
        for _ in range(10):
            event = gen.generate_event("dhcp_server_overload", register_perturbation=False)
            ip = event["metadata"]["server"]["ip"]
            assert ip in dhcp_ips, f"Server IP {ip} not in config"

    def test_non_server_events_have_no_server_reference(self, gen):
        for event_type in ["device_restart", "interference_event", "config_change"]:
            event = gen.generate_event(event_type, register_perturbation=False)
            assert "server" not in event["metadata"], (
                f"{event_type} should not include server reference"
            )


# ---------------------------------------------------------------------------
# TestServerEntityRegressions
# ---------------------------------------------------------------------------

class TestServerEntityRegressions:
    """Existing event and config behavior preserved."""

    def test_config_loads_without_servers_section(self):
        """Legacy config.json (no servers) initializes generator without error."""
        from simulator.event_generator import EventGenerator
        gen = EventGenerator(config_path="simulator/config.json")
        # Should generate events without crashing even if no server data
        event = gen.generate_event("dhcp_server_overload", register_perturbation=False)
        assert event["event_type"] == "dhcp_server_overload"
        # Server field may be absent (graceful fallback)
        meta = event["metadata"]
        assert isinstance(meta, dict)

    def test_events_still_have_all_existing_fields(self):
        from simulator.event_generator import EventGenerator
        gen = EventGenerator(config_path="simulator/config.json")
        for event_type in EventGenerator.EVENT_TYPES:
            event = gen.generate_event(event_type, register_perturbation=False)
            for key in ["timestamp", "event_type", "severity", "entity", "message", "metadata"]:
                assert key in event, f"'{key}' missing from {event_type} event"
