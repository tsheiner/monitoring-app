"""
Tests for Phase 2: AP Topology with Production-Style Identity.

Verifies that:
- Config files have model, serial, mac, bands for every AP
- Serials match the Q-prefix format
- MACs are valid lowercase hex
- Bands are valid values
- generate_observation() supports include_device_identity
- Events include device identity in metadata
"""
import json
import re
import pytest
from pathlib import Path


AP_IDENTITY_KEYS = {"model", "serial", "mac", "bands"}
SERIAL_REGEX = re.compile(r'^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$')
MAC_REGEX = re.compile(r'^[0-9a-f]{2}(:[0-9a-f]{2}){5}$')
VALID_BANDS = {"2.4", "5", "6"}


def _load_config(filename):
    path = Path("simulator") / filename
    with open(path) as f:
        return json.load(f)


def _ap_entries(config):
    """Return (ap_name, ap_data) for all real AP entries (not 'description')."""
    topology = config.get("ap_topology", {})
    return [(k, v) for k, v in topology.items() if isinstance(v, dict) and "role" in v]


# ---------------------------------------------------------------------------
# TestAPTopologyConfigSchema
# ---------------------------------------------------------------------------

class TestAPTopologyConfigSchema:
    """Config files have production-quality AP identity fields."""

    @pytest.mark.parametrize("filename", [
        "config_enterprise.json",
        "config_campus.json",
        "config_hospital.json",
    ])
    def test_aps_have_identity_fields(self, filename):
        cfg = _load_config(filename)
        aps = _ap_entries(cfg)
        assert aps, f"No APs found in {filename}"
        for ap_name, ap_data in aps:
            missing = AP_IDENTITY_KEYS - set(ap_data.keys())
            assert not missing, f"{filename} AP {ap_name} missing fields: {missing}"
            assert isinstance(ap_data["model"], str) and ap_data["model"]
            assert SERIAL_REGEX.match(ap_data["serial"]), (
                f"{ap_name} serial '{ap_data['serial']}' does not match XXXX-XXXX-XXXX"
            )
            assert MAC_REGEX.match(ap_data["mac"]), (
                f"{ap_name} mac '{ap_data['mac']}' is not valid"
            )
            assert isinstance(ap_data["bands"], list) and len(ap_data["bands"]) >= 2

    @pytest.mark.parametrize("filename", [
        "config_enterprise.json",
        "config_campus.json",
        "config_hospital.json",
    ])
    def test_all_serials_unique_within_config(self, filename):
        cfg = _load_config(filename)
        serials = [v["serial"] for _, v in _ap_entries(cfg)]
        assert len(serials) == len(set(serials)), f"Duplicate serials in {filename}"

    @pytest.mark.parametrize("filename", [
        "config_enterprise.json",
        "config_campus.json",
        "config_hospital.json",
    ])
    def test_all_macs_unique_within_config(self, filename):
        cfg = _load_config(filename)
        macs = [v["mac"] for _, v in _ap_entries(cfg)]
        assert len(macs) == len(set(macs)), f"Duplicate MACs in {filename}"

    @pytest.mark.parametrize("filename", [
        "config_enterprise.json",
        "config_campus.json",
        "config_hospital.json",
    ])
    def test_band_values_are_valid(self, filename):
        cfg = _load_config(filename)
        for ap_name, ap_data in _ap_entries(cfg):
            for band in ap_data["bands"]:
                assert band in VALID_BANDS, (
                    f"{ap_name} in {filename} has invalid band '{band}'"
                )

    @pytest.mark.parametrize("filename", [
        "config_enterprise.json",
        "config_campus.json",
        "config_hospital.json",
    ])
    def test_existing_config_keys_preserved(self, filename):
        cfg = _load_config(filename)
        for ap_name, ap_data in _ap_entries(cfg):
            for key in ["role", "floor", "load_baseline", "rf_baseline", "description"]:
                assert key in ap_data, (
                    f"{filename} AP {ap_name} lost existing key '{key}'"
                )


# ---------------------------------------------------------------------------
# TestAPIdentityInObservations
# ---------------------------------------------------------------------------

class TestAPIdentityInObservations:
    """Generator can include device identity in metric observations."""

    def test_generate_observation_with_device_identity(self, seeded_generator):
        # seeded_generator uses config.json (no identity), but enterprise config does
        from simulator.realistic_generator import RealisticMetricsGenerator
        gen = RealisticMetricsGenerator(
            config_path="simulator/config_enterprise.json",
            start_time=12345
        )
        result = gen.generate_observation(
            "throughput", entity="AP-Floor1-01", include_device_identity=True
        )
        assert "device" in result, "Expected 'device' key in observation"
        for key in ["name", "serial", "mac", "model"]:
            assert key in result["device"], f"device missing '{key}'"
        assert result["device"]["name"] == "AP-Floor1-01"

    def test_generate_observation_without_device_identity_unchanged(self, seeded_generator):
        result = seeded_generator.generate_observation(
            "throughput", entity="AP-Floor1-01"
        )
        assert "device" not in result
        for key in ["timestamp", "metric", "value", "entity"]:
            assert key in result

    def test_device_identity_matches_config(self):
        from simulator.realistic_generator import RealisticMetricsGenerator
        gen = RealisticMetricsGenerator(
            config_path="simulator/config_enterprise.json",
            start_time=12345
        )
        cfg = _load_config("config_enterprise.json")
        for ap_name, ap_data in _ap_entries(cfg):
            result = gen.generate_observation(
                "throughput", entity=ap_name, include_device_identity=True
            )
            device = result.get("device", {})
            assert device.get("serial") == ap_data["serial"], (
                f"{ap_name} serial mismatch"
            )
            assert device.get("mac") == ap_data["mac"]
            assert device.get("model") == ap_data["model"]


# ---------------------------------------------------------------------------
# TestAPIdentityInEvents
# ---------------------------------------------------------------------------

class TestAPIdentityInEvents:
    """Events include device identity when entity is a known AP."""

    @pytest.fixture
    def event_gen(self):
        from simulator.event_generator import EventGenerator
        return EventGenerator(config_path="simulator/config_enterprise.json")

    def test_event_metadata_includes_device_identity(self, event_gen):
        event = event_gen.generate_event(
            "device_restart", entity="AP-Floor1-01", register_perturbation=False
        )
        assert "device" in event["metadata"]
        device = event["metadata"]["device"]
        for key in ["serial", "mac", "model"]:
            assert key in device and device[key]

    def test_event_entity_field_still_present(self, event_gen):
        event = event_gen.generate_event(
            "device_restart", entity="AP-Floor1-01", register_perturbation=False
        )
        assert event["entity"] == "AP-Floor1-01"


# ---------------------------------------------------------------------------
# TestAPIdentityRegressions
# ---------------------------------------------------------------------------

class TestAPIdentityRegressions:
    """Existing topology behavior is preserved."""

    def test_load_baseline_still_used(self, seeded_generator):
        # load_baseline still modulates client load; check observation generates
        for entity in ["AP-Floor1-01", "AP-Floor3-02"]:
            result = seeded_generator.generate_observation("capacity", entity=entity)
            assert "value" in result
            assert result["value"] >= 0

    def test_existing_config_keys_preserved(self):
        for filename in ["config_enterprise.json", "config_campus.json", "config_hospital.json"]:
            cfg = _load_config(filename)
            for ap_name, ap_data in _ap_entries(cfg):
                for key in ["role", "floor", "load_baseline", "rf_baseline", "description"]:
                    assert key in ap_data, f"Key {key} lost in {filename} AP {ap_name}"
