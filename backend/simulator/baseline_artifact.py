"""Lifecycle helpers for the clean baseline artifact.

The simulator's metric baselines describe clean, expected behavior. They are
therefore model artifacts rather than a permanent side effect of the metrics
database. This module centralizes their path, compatibility metadata, and
atomic writes so continuous operation can safely reuse or refresh them.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Optional


# Bump this when the baseline calculation semantics change.
BASELINE_FORMAT_VERSION = 2
BASELINE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
BASELINE_CHECK_INTERVAL_SECONDS = 60 * 60


def get_baseline_path() -> Path:
    """Return the baseline path independently of the process working directory."""

    configured_data_dir = os.environ.get("MONITORING_DATA_DIR")
    if configured_data_dir:
        return Path(configured_data_dir) / "baselines.json"
    return Path(__file__).resolve().parent.parent / "data" / "baselines.json"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def current_baseline_fingerprint() -> str:
    """Fingerprint inputs that can change the clean metric distributions."""

    from simulator.realistic_generator import get_config_path

    config_path = get_config_path()
    generator_path = Path(__file__).resolve().parent / "realistic_generator.py"
    bootstrap_path = Path(__file__).resolve().parent / "bootstrap.py"
    payload = {
        "format_version": BASELINE_FORMAT_VERSION,
        "profile": os.environ.get("NETWORK_PROFILE", "enterprise").lower(),
        "config_sha256": _sha256(config_path),
        "generator_sha256": _sha256(generator_path),
        "bootstrap_sha256": _sha256(bootstrap_path),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def build_baseline_metadata(
    *, generated_at: int, n_aps: int, ap_list: list[str], lookback_days: float
) -> dict[str, Any]:
    """Build compatibility metadata for a newly generated baseline."""

    return {
        "baseline_format_version": BASELINE_FORMAT_VERSION,
        "baseline_fingerprint": current_baseline_fingerprint(),
        "generated_at": generated_at,
        "lookback_days": lookback_days,
        "n_aps": n_aps,
        "ap_list": ap_list,
        "profile": os.environ.get("NETWORK_PROFILE", "enterprise").lower(),
    }


def load_baseline(path: Optional[Path] = None) -> Optional[dict[str, Any]]:
    """Load a baseline artifact, returning ``None`` when it is absent/invalid."""

    baseline_path = path or get_baseline_path()
    try:
        with baseline_path.open() as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError, TypeError):
        return None


def baseline_staleness_reason(
    baseline: Optional[dict[str, Any]],
    *,
    now: Optional[int] = None,
    max_age_seconds: int = BASELINE_MAX_AGE_SECONDS,
) -> Optional[str]:
    """Return why an artifact must be refreshed, or ``None`` if it is current."""

    if baseline is None:
        return "missing or unreadable"

    if baseline.get("baseline_format_version") != BASELINE_FORMAT_VERSION:
        return "baseline format changed"

    expected_fingerprint = current_baseline_fingerprint()
    if baseline.get("baseline_fingerprint") != expected_fingerprint:
        return "generator, configuration, or baseline algorithm changed"

    generated_at = baseline.get("generated_at")
    if not isinstance(generated_at, (int, float)):
        return "generation timestamp missing"

    age = (now if now is not None else int(time.time())) - int(generated_at)
    if age > max_age_seconds:
        return f"artifact is {age / 86400:.1f} days old"
    if age < 0:
        return "generation timestamp is in the future"

    return None


def write_baseline_atomically(
    baseline: dict[str, Any], path: Optional[Path] = None
) -> Path:
    """Replace the baseline artifact atomically so readers never see partial JSON."""

    baseline_path = path or get_baseline_path()
    baseline_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{baseline_path.name}.",
        suffix=".tmp",
        dir=baseline_path.parent,
    )
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(baseline, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, baseline_path)
    except Exception:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise
    return baseline_path
