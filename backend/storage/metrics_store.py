"""
SQLite-backed metrics storage.

Stores time-series observations with optional classifier payloads.
Uses SQLite for bounded memory usage regardless of data volume.

Migrated from TinyFlux (CSV + sidecar JSON) to SQLite to fix unbounded
memory growth from in-memory data structures (classifier cache dict and
TinyFlux's full-CSV-in-RAM design).
"""
import os
import time
import json
import sqlite3
from typing import List, Dict, Optional
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

import numpy as np


class MetricsStore:
    """Store and query metric observations using SQLite."""

    def __init__(self, db_path: str = "data/metrics.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

        self.db_path = db_path
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self._create_schema()

    def _create_schema(self) -> None:
        cursor = self.conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                metric TEXT NOT NULL,
                entity TEXT NOT NULL DEFAULT '_global',
                value REAL NOT NULL,
                classifiers TEXT
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_metrics_metric_ts
            ON metrics(metric, timestamp)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_metrics_metric_entity_ts
            ON metrics(metric, entity, timestamp)
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_metrics_ts
            ON metrics(timestamp)
        """)
        self.conn.commit()

    def insert_observation(self, observation: Dict) -> None:
        """
        Insert a single metric observation.

        Args:
            observation: Dict with timestamp, metric, value, optional entity, and optional classifiers
        """
        classifiers_json = None
        if "classifiers" in observation and observation["classifiers"] is not None:
            classifiers_json = json.dumps(observation["classifiers"])

        self.conn.execute(
            "INSERT INTO metrics (timestamp, metric, entity, value, classifiers) VALUES (?, ?, ?, ?, ?)",
            (
                observation["timestamp"],
                observation["metric"],
                observation.get("entity", "_global"),
                observation["value"],
                classifiers_json,
            ),
        )
        self.conn.commit()

    def flush_classifiers(self) -> None:
        """No-op. Classifiers are stored inline with each observation in SQLite."""
        pass

    def insert_batch(self, observations: List[Dict]) -> None:
        """
        Insert multiple observations efficiently.

        Args:
            observations: List of observation dicts (each may have optional classifiers)
        """
        rows = []
        for obs in observations:
            classifiers_json = None
            if "classifiers" in obs and obs["classifiers"] is not None:
                classifiers_json = json.dumps(obs["classifiers"])
            rows.append((
                obs["timestamp"],
                obs["metric"],
                obs.get("entity", "_global"),
                obs["value"],
                classifiers_json,
            ))

        self.conn.executemany(
            "INSERT INTO metrics (timestamp, metric, entity, value, classifiers) VALUES (?, ?, ?, ?, ?)",
            rows,
        )
        self.conn.commit()

    def query_range(
        self,
        metric: str,
        start: int,
        end: int,
        entity: Optional[str] = None,
    ) -> List[Dict]:
        """
        Query observations in a time range.

        Args:
            metric: Metric name
            start: Start timestamp (inclusive)
            end: End timestamp (inclusive)
            entity: Optional entity filter (AP name or "_global")

        Returns:
            List of observation dicts sorted by timestamp
        """
        if entity is not None:
            rows = self.conn.execute(
                "SELECT timestamp, metric, entity, value, classifiers FROM metrics "
                "WHERE metric = ? AND entity = ? AND timestamp BETWEEN ? AND ? "
                "ORDER BY timestamp ASC",
                (metric, entity, start, end),
            ).fetchall()
        else:
            rows = self.conn.execute(
                "SELECT timestamp, metric, entity, value, classifiers FROM metrics "
                "WHERE metric = ? AND timestamp BETWEEN ? AND ? "
                "ORDER BY timestamp ASC",
                (metric, start, end),
            ).fetchall()

        return [self._row_to_dict(row) for row in rows]

    def compute_distribution(
        self,
        metric: str,
        start: int,
        end: int,
        entity: Optional[str] = None,
        observations: Optional[List[Dict]] = None,
    ) -> Optional[Dict]:
        """
        Compute statistical distribution for metric in time range.

        Args:
            metric: Metric name
            start: Start timestamp
            end: End timestamp
            entity: Optional entity filter
            observations: Pre-fetched observations to compute from (avoids re-query)

        Returns:
            Dict with percentiles (p1, p5, p10, p25, p50, p75, p90, p95, p99), mean, stddev
            None if no data in range
        """
        if observations is None:
            observations = self.query_range(metric, start, end, entity=entity)

        if not observations:
            return None

        values = np.array([obs["value"] for obs in observations])

        return {
            "p1": float(np.percentile(values, 1)),
            "p5": float(np.percentile(values, 5)),
            "p10": float(np.percentile(values, 10)),
            "p25": float(np.percentile(values, 25)),
            "p50": float(np.percentile(values, 50)),
            "p75": float(np.percentile(values, 75)),
            "p90": float(np.percentile(values, 90)),
            "p95": float(np.percentile(values, 95)),
            "p99": float(np.percentile(values, 99)),
            "mean": float(np.mean(values)),
            "stddev": float(np.std(values)),
            "count": len(values),
        }

    def get_latest(self, metric: str, limit: int = 100) -> List[Dict]:
        """
        Get most recent observations for a metric.

        Args:
            metric: Metric name
            limit: Max number of observations

        Returns:
            List of latest observations, newest first
        """
        rows = self.conn.execute(
            "SELECT timestamp, metric, entity, value, classifiers FROM metrics "
            "WHERE metric = ? ORDER BY timestamp DESC LIMIT ?",
            (metric, limit),
        ).fetchall()

        return [self._row_to_dict(row) for row in rows]

    def count_observations(self, metric: str) -> int:
        """
        Count total observations for a metric.

        Args:
            metric: Metric name

        Returns:
            Count of observations
        """
        row = self.conn.execute(
            "SELECT COUNT(*) FROM metrics WHERE metric = ?", (metric,)
        ).fetchone()
        return row[0]

    def count_all(self) -> int:
        """Count total observations across all metrics."""
        row = self.conn.execute("SELECT COUNT(*) FROM metrics").fetchone()
        return row[0]

    def delete_all(self, metric: str) -> None:
        """
        Delete all observations for a metric.

        Args:
            metric: Metric name
        """
        self.conn.execute("DELETE FROM metrics WHERE metric = ?", (metric,))
        self.conn.commit()

    def delete_older_than(self, cutoff_timestamp: int) -> int:
        """
        Delete all observations older than the cutoff timestamp.

        Args:
            cutoff_timestamp: Unix timestamp - delete everything before this

        Returns:
            Number of observations deleted
        """
        cursor = self.conn.execute(
            "SELECT COUNT(*) FROM metrics WHERE timestamp < ?", (cutoff_timestamp,)
        )
        count = cursor.fetchone()[0]

        self.conn.execute("DELETE FROM metrics WHERE timestamp < ?", (cutoff_timestamp,))
        self.conn.commit()

        return count

    def vacuum(self) -> None:
        """Reclaim disk space after deletes and checkpoint WAL."""
        # First checkpoint the WAL to merge it into the main database
        self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        # Then vacuum to reclaim space
        self.conn.execute("VACUUM")

    def get_precomputed_baseline(self, metric: str) -> Optional[List[Dict]]:
        """
        Load pre-computed baseline distributions from the JSON file.

        Baselines are computed during bootstrap from clean (perturbation-free)
        high-resolution data and saved to data/baselines.json.

        Args:
            metric: Metric name

        Returns:
            List of 24 hourly distribution dicts, or None if not available
        """
        baselines_path = Path("data/baselines.json")
        if not baselines_path.exists():
            return None

        try:
            with open(baselines_path, "r") as f:
                data = json.load(f)

            metric_baseline = data.get("metrics", {}).get(metric)
            if metric_baseline and len(metric_baseline) > 0:
                return metric_baseline
            return None
        except Exception as e:
            print(f"Warning: Failed to load pre-computed baseline: {e}")
            return None

    def compute_baseline_distribution(
        self,
        metric: str,
        entity: Optional[str] = None,
        lookback_days: int = 30,
        tz: Optional[str] = None,
    ) -> List[Dict]:
        """
        Get hourly baseline distributions for a metric.

        Prefers pre-computed baselines from bootstrap (computed from clean,
        perturbation-free high-resolution data). Falls back to on-the-fly
        computation from stored data if pre-computed baselines are unavailable.

        Args:
            metric: Metric name
            entity: Optional entity (AP) filter (ignored for pre-computed)
            lookback_days: Number of days of history to include
            tz: Optional timezone name (defaults to local time)

        Returns:
            List of 24 hourly distribution dicts with fallback metadata
        """
        precomputed = self.get_precomputed_baseline(metric)
        if precomputed:
            return precomputed

        end = int(time.time()) - 3600
        start = end - (lookback_days * 86400)
        observations = self.query_range(metric, start, end, entity=entity)

        if not observations:
            return self._fill_baseline_gaps([], metric, entity)

        observations = self._resample_to_fixed_cadence(observations, cadence_seconds=3600)

        hourly_bins = defaultdict(list)
        for obs in observations:
            if tz:
                try:
                    import pytz
                    tzinfo = pytz.timezone(tz)
                    dt = datetime.fromtimestamp(obs["timestamp"], tz=tzinfo)
                except Exception:
                    dt = datetime.fromtimestamp(obs["timestamp"])
            else:
                dt = datetime.fromtimestamp(obs["timestamp"])
            hour = dt.hour
            hourly_bins[hour].append(obs["value"])

        result = []
        for hour in range(24):
            values = hourly_bins.get(hour, [])
            if len(values) >= 5:
                result.append({
                    "hour": hour,
                    "distribution": {
                        "p1": float(np.percentile(values, 1)),
                        "p5": float(np.percentile(values, 5)),
                        "p10": float(np.percentile(values, 10)),
                        "p25": float(np.percentile(values, 25)),
                        "p50": float(np.percentile(values, 50)),
                        "p75": float(np.percentile(values, 75)),
                        "p90": float(np.percentile(values, 90)),
                        "p95": float(np.percentile(values, 95)),
                        "p99": float(np.percentile(values, 99)),
                        "mean": float(np.mean(values)),
                        "stddev": float(np.std(values)),
                    },
                    "fallback_source": "data",
                    "sample_count": len(values),
                })

        result = self._fill_baseline_gaps(result, metric, entity)
        return result

    def _resample_to_fixed_cadence(
        self, observations: List[Dict], cadence_seconds: int
    ) -> List[Dict]:
        """Resample observations to a fixed time cadence to prevent density bias."""
        if not observations:
            return []

        windows = defaultdict(list)
        for obs in observations:
            window_start = (obs["timestamp"] // cadence_seconds) * cadence_seconds
            windows[window_start].append(obs["value"])

        resampled = []
        for window_start in sorted(windows.keys()):
            values = windows[window_start]
            resampled.append({
                "timestamp": window_start,
                "value": float(np.median(values)),
                "entity": observations[0].get("entity", "_global"),
            })

        return resampled

    def _fill_baseline_gaps(
        self,
        baseline: List[Dict],
        metric: str,
        entity: Optional[str] = None,
    ) -> List[Dict]:
        """Fill missing hourly bins using a tiered fallback hierarchy."""
        covered_hours = {b["hour"] for b in baseline}
        if len(covered_hours) == 24:
            return baseline

        cfg = self._get_metric_config(metric)
        if not cfg:
            return baseline

        metric_range = cfg["max"] - cfg["min"]

        for hour in range(24):
            if hour in covered_hours:
                continue

            dist = self._try_wider_bin(metric, entity, hour, bin_width_hours=4)
            if dist:
                baseline.append({
                    "hour": hour,
                    "distribution": dist,
                    "fallback_source": "entity_4h_bin",
                    "sample_count": dist.pop("count", 0),
                })
                continue

            dist = self._try_global_scaled(metric, entity, hour)
            if dist:
                baseline.append({
                    "hour": hour,
                    "distribution": dist,
                    "fallback_source": "global_scaled",
                    "sample_count": dist.pop("count", 0),
                })
                continue

            variance = (cfg.get("typical_variance_pct", 3) / 100) * metric_range
            baseline.append({
                "hour": hour,
                "distribution": self._synthetic_distribution(cfg["baseline"], variance),
                "fallback_source": "synthetic_config",
                "sample_count": 0,
            })

        baseline.sort(key=lambda b: b["hour"])
        return baseline

    def _try_wider_bin(
        self, metric: str, entity: Optional[str], target_hour: int, bin_width_hours: int
    ) -> Optional[Dict]:
        """Try computing distribution from a wider time bin."""
        end = int(time.time())
        start = end - (30 * 86400)
        observations = self.query_range(metric, start, end, entity=entity)

        if not observations:
            return None

        values = []
        for obs in observations:
            dt = datetime.fromtimestamp(obs["timestamp"])
            hour = dt.hour
            hour_diff = min(
                abs(hour - target_hour),
                abs(hour - target_hour + 24),
                abs(hour - target_hour - 24),
            )
            if hour_diff < bin_width_hours // 2:
                values.append(obs["value"])

        if len(values) >= 5:
            return {
                "p1": float(np.percentile(values, 1)),
                "p5": float(np.percentile(values, 5)),
                "p10": float(np.percentile(values, 10)),
                "p25": float(np.percentile(values, 25)),
                "p50": float(np.percentile(values, 50)),
                "p75": float(np.percentile(values, 75)),
                "p90": float(np.percentile(values, 90)),
                "p95": float(np.percentile(values, 95)),
                "p99": float(np.percentile(values, 99)),
                "mean": float(np.mean(values)),
                "stddev": float(np.std(values)),
                "count": len(values),
            }

        return None

    def _try_global_scaled(
        self, metric: str, entity: Optional[str], hour: int
    ) -> Optional[Dict]:
        """Try computing distribution from global data scaled by AP topology offsets."""
        if not entity or entity == "_global":
            return None

        end = int(time.time())
        start = end - (30 * 86400)
        global_obs = self.query_range(metric, start, end, entity="_global")

        if not global_obs:
            return None

        hour_values = []
        for obs in global_obs:
            dt = datetime.fromtimestamp(obs["timestamp"])
            if dt.hour == hour:
                hour_values.append(obs["value"])

        if len(hour_values) < 5:
            return None

        return {
            "p1": float(np.percentile(hour_values, 1)),
            "p5": float(np.percentile(hour_values, 5)),
            "p10": float(np.percentile(hour_values, 10)),
            "p25": float(np.percentile(hour_values, 25)),
            "p50": float(np.percentile(hour_values, 50)),
            "p75": float(np.percentile(hour_values, 75)),
            "p90": float(np.percentile(hour_values, 90)),
            "p95": float(np.percentile(hour_values, 95)),
            "p99": float(np.percentile(hour_values, 99)),
            "mean": float(np.mean(hour_values)),
            "stddev": float(np.std(hour_values)),
            "count": len(hour_values),
        }

    def _synthetic_distribution(self, baseline: float, variance: float) -> Dict:
        """Generate a synthetic distribution from config baseline and variance."""
        return {
            "p1": float(baseline - 2.33 * variance),
            "p5": float(baseline - 1.645 * variance),
            "p10": float(baseline - 1.28 * variance),
            "p25": float(baseline - 0.674 * variance),
            "p50": float(baseline),
            "p75": float(baseline + 0.674 * variance),
            "p90": float(baseline + 1.28 * variance),
            "p95": float(baseline + 1.645 * variance),
            "p99": float(baseline + 2.33 * variance),
            "mean": float(baseline),
            "stddev": float(variance),
        }

    def _get_metric_config(self, metric: str) -> Optional[Dict]:
        """Load metric configuration from config file."""
        try:
            config_path = Path("simulator/config_enterprise.json")
            if not config_path.exists():
                return None
            with open(config_path, "r") as f:
                config = json.load(f)
            return config.get(metric)
        except Exception:
            return None

    def close(self) -> None:
        """Close database connection."""
        self.conn.close()

    @staticmethod
    def _row_to_dict(row) -> Dict:
        obs = {
            "timestamp": row["timestamp"],
            "metric": row["metric"],
            "value": row["value"],
            "entity": row["entity"],
        }
        if row["classifiers"]:
            obs["classifiers"] = json.loads(row["classifiers"])
        return obs


# Singleton instance
_store_instance = None


def get_metrics_store(db_path: str = "data/metrics.db") -> MetricsStore:
    """Get or create the global metrics store instance."""
    global _store_instance
    if _store_instance is None:
        _store_instance = MetricsStore(db_path)
    return _store_instance


def reset_metrics_store() -> None:
    """Reset the singleton instance (called after clearing data)."""
    global _store_instance
    if _store_instance is not None:
        _store_instance.close()
        _store_instance = None
