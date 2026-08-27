"""Regression tests for continuous clean-baseline lifecycle management."""

import json
import time

from simulator.baseline_artifact import (
    BASELINE_FORMAT_VERSION,
    baseline_staleness_reason,
    build_baseline_metadata,
    current_baseline_fingerprint,
    write_baseline_atomically,
)


def _artifact(generated_at: int) -> dict:
    return {
        **build_baseline_metadata(
            generated_at=generated_at,
            n_aps=1,
            ap_list=["AP-Floor1-01"],
            lookback_days=29.75,
        ),
        "metrics": {},
        "classifiers": {},
    }


def test_current_baseline_artifact_is_accepted():
    artifact = _artifact(1_800_000_000)

    assert baseline_staleness_reason(
        artifact,
        now=1_800_000_000 + 60,
        max_age_seconds=3600,
    ) is None


def test_old_or_incompatible_baseline_is_rejected():
    now = 1_800_000_000
    old = _artifact(now - 3601)
    assert "days old" in (baseline_staleness_reason(old, now=now, max_age_seconds=3600) or "")

    changed = _artifact(now)
    changed["baseline_fingerprint"] = "old-fingerprint"
    assert baseline_staleness_reason(changed, now=now) == (
        "generator, configuration, or baseline algorithm changed"
    )

    changed["baseline_fingerprint"] = current_baseline_fingerprint()
    changed["baseline_format_version"] = BASELINE_FORMAT_VERSION - 1
    assert baseline_staleness_reason(changed, now=now) == "baseline format changed"


def test_missing_and_malformed_artifacts_are_rejected():
    assert baseline_staleness_reason(None) == "missing or unreadable"
    assert baseline_staleness_reason({"generated_at": int(time.time())}) == (
        "baseline format changed"
    )


def test_baseline_write_is_atomic_and_round_trips(tmp_path):
    path = tmp_path / "baselines.json"
    artifact = _artifact(int(time.time()))

    write_baseline_atomically(artifact, path)

    assert json.loads(path.read_text()) == artifact
    assert list(tmp_path.glob("*.tmp")) == []


def test_continuous_startup_refreshes_stale_baseline_without_bootstrap(
    tmp_path, monkeypatch
):
    from simulator import bootstrap

    monkeypatch.setenv("MONITORING_DATA_DIR", str(tmp_path))
    stale = _artifact(1_700_000_000)
    write_baseline_atomically(stale)

    refreshed = _artifact(1_800_000_000)
    calls = []

    def fake_refresh(now=None):
        calls.append(now)
        write_baseline_atomically(refreshed)
        return tmp_path / "baselines.json"

    monkeypatch.setattr(bootstrap, "refresh_precomputed_baselines", fake_refresh)

    result = bootstrap.ensure_precomputed_baselines_current(now=1_800_000_000)

    assert result == tmp_path / "baselines.json"
    assert calls == [1_800_000_000]
    assert json.loads(result.read_text()) == refreshed


def test_clean_refresh_uses_current_generator_ranges(monkeypatch):
    from simulator import bootstrap

    # Keep this integration check small while exercising the real clean-sample
    # generation and percentile calculation path.
    monkeypatch.setattr(bootstrap, "TOTAL_DURATION", 24 * 60 * 60)
    artifact = bootstrap.generate_clean_baseline_artifact(now=1_800_000_000)

    time_to_connect = artifact["metrics"]["time_to_connect"]
    p50_values = [entry["distribution"]["p50"] for entry in time_to_connect]
    assert p50_values
    assert min(p50_values) > 30
    assert max(p50_values) < 45
    assert artifact["baseline_format_version"] == BASELINE_FORMAT_VERSION


def test_health_reports_baseline_degradation(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from server import http_api

    monkeypatch.setattr(http_api, "get_baseline_path", lambda: tmp_path / "baselines.json")
    client = TestClient(http_api.app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"
    assert response.json()["baseline"]["status"] == "stale"
