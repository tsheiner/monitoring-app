"""
TinyFlux wrapper for metrics storage.

Stores time-series observations and provides range queries with distribution computation.

Storage Strategy for Classifier Payloads (FD-010):
- TinyFlux stores scalar metric values (timestamp, metric, entity, value)
- Classifiers are stored in a sidecar JSON file keyed by (timestamp, metric, entity)
- This approach keeps TinyFlux for efficient time-series queries while supporting
  classifier payloads without schema migration
- Backward compatible: queries work with or without classifier data present
- Classifier file: {db_path}.classifiers.json (e.g., data/metrics.csv.classifiers.json)
"""
import os
import time
import json
from typing import List, Dict, Optional
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

import numpy as np
from tinyflux import TinyFlux, Point, TagQuery, TimeQuery


class MetricsStore:
    """Store and query metric observations using TinyFlux."""
    
    def __init__(self, db_path: str = "data/metrics.csv"):
        """
        Initialize metrics store.
        
        Args:
            db_path: Path to TinyFlux CSV file
        """
        # Ensure directory exists
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        
        self.db = TinyFlux(db_path)
        
        # Sidecar file for classifier payloads (FD-010)
        self.classifiers_path = f"{db_path}.classifiers.json"
        self._classifiers_cache = self._load_classifiers()
    
    def _load_classifiers(self) -> Dict:
        """Load classifier sidecar data."""
        if os.path.exists(self.classifiers_path):
            try:
                with open(self.classifiers_path, 'r') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return {}
        return {}
    
    def _save_classifiers(self) -> None:
        """Save classifier sidecar data."""
        with open(self.classifiers_path, 'w') as f:
            json.dump(self._classifiers_cache, f)

    def flush_classifiers(self) -> None:
        """Persist the in-memory classifier cache to disk.
        
        Call this once after a batch of insert_observation() calls
        rather than saving on every individual insert.
        """
        if self._classifiers_cache:
            self._save_classifiers()
    
    def _classifier_key(self, timestamp: int, metric: str, entity: str) -> str:
        """Generate key for classifier lookup."""
        return f"{timestamp}:{metric}:{entity}"
    
    def insert_observation(self, observation: Dict) -> None:
        """
        Insert a single metric observation.
        
        Args:
            observation: Dict with timestamp, metric, value, optional entity, and optional classifiers
        """
        # Store scalar value in TinyFlux
        point = Point(
            time=datetime.fromtimestamp(observation["timestamp"], tz=timezone.utc),
            tags={
                "metric": observation["metric"],
                "entity": observation.get("entity", "_global")
            },
            fields={"value": observation["value"]}
        )
        self.db.insert(point)
        
        # Store classifiers in sidecar if present (FD-010)
        if "classifiers" in observation and observation["classifiers"] is not None:
            key = self._classifier_key(
                observation["timestamp"],
                observation["metric"],
                observation.get("entity", "_global")
            )
            self._classifiers_cache[key] = observation["classifiers"]
    
    def insert_batch(self, observations: List[Dict]) -> None:
        """
        Insert multiple observations efficiently.
        
        Args:
            observations: List of observation dicts (each may have optional classifiers)
        """
        # Store scalar values in TinyFlux
        points = []
        for obs in observations:
            points.append(Point(
                time=datetime.fromtimestamp(obs["timestamp"], tz=timezone.utc),
                tags={
                    "metric": obs["metric"],
                    "entity": obs.get("entity", "_global")
                },
                fields={"value": obs["value"]}
            ))
            
            # Store classifiers in sidecar if present (FD-010)
            if "classifiers" in obs and obs["classifiers"] is not None:
                key = self._classifier_key(
                    obs["timestamp"],
                    obs["metric"],
                    obs.get("entity", "_global")
                )
                self._classifiers_cache[key] = obs["classifiers"]
        
        self.db.insert_multiple(points)
        # Save classifiers once for entire batch
        self._save_classifiers()
    
    def query_range(
        self,
        metric: str,
        start: int,
        end: int,
        entity: Optional[str] = None
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
        Tag = TagQuery()
        Time = TimeQuery()
        # Use UTC for all timestamps to avoid timezone confusion
        start_dt = datetime.fromtimestamp(start, tz=timezone.utc)
        end_dt = datetime.fromtimestamp(end, tz=timezone.utc)
        
        # Build query with optional entity filter
        query = (Tag.metric == metric) & (Time >= start_dt) & (Time <= end_dt)
        if entity is not None:
            query = query & (Tag.entity == entity)
        
        results = self.db.search(query)
        
        observations = []
        for point in results:
            timestamp = int(point.time.timestamp())
            entity = point.tags.get("entity", "_global")
            
            obs = {
                "timestamp": timestamp,
                "metric": metric,
                "value": point.fields["value"],
                "entity": entity
            }
            
            # Load classifiers from sidecar if present (FD-010)
            key = self._classifier_key(timestamp, metric, entity)
            if key in self._classifiers_cache:
                obs["classifiers"] = self._classifiers_cache[key]
            
            observations.append(obs)
        
        # Sort by timestamp
        observations.sort(key=lambda x: x["timestamp"])
        
        return observations
    
    def compute_distribution(
        self,
        metric: str,
        start: int,
        end: int,
        entity: Optional[str] = None,
        observations: Optional[List[Dict]] = None
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
            "p50": float(np.percentile(values, 50)),  # median
            "p75": float(np.percentile(values, 75)),
            "p90": float(np.percentile(values, 90)),
            "p95": float(np.percentile(values, 95)),
            "p99": float(np.percentile(values, 99)),
            "mean": float(np.mean(values)),
            "stddev": float(np.std(values)),
            "count": len(values)
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
        Tag = TagQuery()
        
        results = self.db.search(Tag.metric == metric)
        
        observations = []
        for point in results:
            timestamp = int(point.time.timestamp())
            entity = point.tags.get("entity", "_global")
            
            obs = {
                "timestamp": timestamp,
                "metric": metric,
                "value": point.fields["value"],
                "entity": entity
            }
            
            # Load classifiers from sidecar if present (FD-010)
            key = self._classifier_key(timestamp, metric, entity)
            if key in self._classifiers_cache:
                obs["classifiers"] = self._classifiers_cache[key]
            
            observations.append(obs)
        
        # Sort by timestamp descending and limit
        observations.sort(key=lambda x: x["timestamp"], reverse=True)
        
        return observations[:limit]
    
    def count_observations(self, metric: str) -> int:
        """
        Count total observations for a metric.
        
        Args:
            metric: Metric name
            
        Returns:
            Count of observations
        """
        Tag = TagQuery()
        results = self.db.search(Tag.metric == metric)
        return len(results)
    
    def delete_all(self, metric: str) -> None:
        """
        Delete all observations for a metric.
        
        Args:
            metric: Metric name
        """
        Tag = TagQuery()
        self.db.remove(Tag.metric == metric)
    
    def delete_older_than(self, cutoff_timestamp: int) -> int:
        """
        Delete all observations older than the cutoff timestamp.
        
        Args:
            cutoff_timestamp: Unix timestamp - delete everything before this
            
        Returns:
            Number of observations deleted
        """
        Time = TimeQuery()
        cutoff_dt = datetime.fromtimestamp(cutoff_timestamp, tz=timezone.utc)
        
        # Get count before deletion
        old_count = len(self.db)
        
        # Delete old data
        self.db.remove(Time < cutoff_dt)
        
        # Return count of deleted items
        new_count = len(self.db)
        return old_count - new_count
    
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
        tz: Optional[str] = None
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
        # Prefer pre-computed baselines (clean, from bootstrap Phase 2)
        precomputed = self.get_precomputed_baseline(metric)
        if precomputed:
            return precomputed
        
        # Fallback: compute from stored data (includes perturbation effects)
        end = int(time.time()) - 3600
        start = end - (lookback_days * 86400)
        observations = self.query_range(metric, start, end, entity=entity)
        
        if not observations:
            # No data at all - fill all bins with synthetic fallback
            return self._fill_baseline_gaps([], metric, entity)
        
        # Resample to fixed cadence to correct for tiered bootstrap bias
        # (720 points in last 2h vs 40 across first 20 days)
        observations = self._resample_to_fixed_cadence(observations, cadence_seconds=3600)
        
        # Group by hour-of-day using specified timezone or local time
        hourly_bins = defaultdict(list)
        for obs in observations:
            if tz:
                try:
                    import pytz
                    tzinfo = pytz.timezone(tz)
                    dt = datetime.fromtimestamp(obs["timestamp"], tz=tzinfo)
                except:
                    # Fall back to local time if timezone is invalid
                    dt = datetime.fromtimestamp(obs["timestamp"])
            else:
                dt = datetime.fromtimestamp(obs["timestamp"])
            hour = dt.hour
            hourly_bins[hour].append(obs["value"])
        
        # Compute percentiles per hour
        result = []
        for hour in range(24):
            values = hourly_bins.get(hour, [])
            if len(values) >= 5:  # minimum for meaningful percentiles
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
        
        # Fill gaps using tiered fallback hierarchy
        result = self._fill_baseline_gaps(result, metric, entity)
        
        return result
    
    def _resample_to_fixed_cadence(self, observations: List[Dict], cadence_seconds: int) -> List[Dict]:
        """
        Resample observations to a fixed time cadence to prevent density bias.
        
        The tiered bootstrap creates non-uniform density (720 points in last 2h
        vs 40 across first 20 days). This resamples to one observation per
        cadence window, taking the median value in each window.
        
        Args:
            observations: List of observation dicts
            cadence_seconds: Target interval between observations
        
        Returns:
            Resampled observations list
        """
        if not observations:
            return []
        
        # Group by cadence window
        windows = defaultdict(list)
        for obs in observations:
            window_start = (obs["timestamp"] // cadence_seconds) * cadence_seconds
            windows[window_start].append(obs["value"])
        
        # Take median of each window
        resampled = []
        for window_start in sorted(windows.keys()):
            values = windows[window_start]
            resampled.append({
                "timestamp": window_start,
                "value": float(np.median(values)),
                "entity": observations[0].get("entity", "_global")
            })
        
        return resampled
    
    def _fill_baseline_gaps(
        self,
        baseline: List[Dict],
        metric: str,
        entity: Optional[str] = None
    ) -> List[Dict]:
        """
        Fill missing hourly bins using a tiered fallback hierarchy.
        
        Fallback levels (in order of preference):
        1. Entity hourly (already in baseline - skip)
        2. Entity 4-hour bins (wider window, same AP)
        3. Global hourly scaled by AP topology offsets
        4. Config synthetic from baseline ± typical_variance_pct
        
        Each bin includes fallback_source metadata for observability.
        
        Args:
            baseline: Existing baseline (may have gaps)
            metric: Metric name
            entity: Optional entity name
        
        Returns:
            Complete 24-hour baseline with no gaps
        """
        covered_hours = {b["hour"] for b in baseline}
        if len(covered_hours) == 24:
            return baseline  # No gaps
        
        # Load metric config for synthetic fallback
        cfg = self._get_metric_config(metric)
        if not cfg:
            # If config can't be loaded, just return what we have
            return baseline
        
        metric_range = cfg["max"] - cfg["min"]
        
        for hour in range(24):
            if hour in covered_hours:
                continue
            
            # Level 2: Try 4-hour bin for this entity
            dist = self._try_wider_bin(metric, entity, hour, bin_width_hours=4)
            if dist:
                baseline.append({
                    "hour": hour,
                    "distribution": dist,
                    "fallback_source": "entity_4h_bin",
                    "sample_count": dist.pop("count", 0),
                })
                continue
            
            # Level 3: Global hourly scaled by AP offsets
            dist = self._try_global_scaled(metric, entity, hour)
            if dist:
                baseline.append({
                    "hour": hour,
                    "distribution": dist,
                    "fallback_source": "global_scaled",
                    "sample_count": dist.pop("count", 0),
                })
                continue
            
            # Level 4: Config synthetic
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
        self,
        metric: str,
        entity: Optional[str],
        target_hour: int,
        bin_width_hours: int
    ) -> Optional[Dict]:
        """
        Try computing distribution from a wider time bin (e.g., 4-hour window).
        
        Args:
            metric: Metric name
            entity: Entity filter
            target_hour: Target hour-of-day (0-23)
            bin_width_hours: Width of bin in hours
        
        Returns:
            Distribution dict or None if insufficient data
        """
        end = int(time.time())
        start = end - (30 * 86400)  # 30 days lookback
        observations = self.query_range(metric, start, end, entity=entity)
        
        if not observations:
            return None
        
        # Collect values that fall within the wider bin around target_hour
        values = []
        for obs in observations:
            dt = datetime.fromtimestamp(obs["timestamp"])
            hour = dt.hour
            # Check if hour falls within the bin
            hour_diff = min(abs(hour - target_hour), abs(hour - target_hour + 24), abs(hour - target_hour - 24))
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
        self,
        metric: str,
        entity: Optional[str],
        hour: int
    ) -> Optional[Dict]:
        """
        Try computing distribution from global data scaled by AP topology offsets.
        
        Args:
            metric: Metric name
            entity: Entity name (AP)
            hour: Hour-of-day
        
        Returns:
            Scaled distribution or None if global data insufficient
        """
        if not entity or entity == "_global":
            return None
        
        # Get global baseline for this hour
        end = int(time.time())
        start = end - (30 * 86400)
        global_obs = self.query_range(metric, start, end, entity="_global")
        
        if not global_obs:
            return None
        
        # Filter to this hour
        hour_values = []
        for obs in global_obs:
            dt = datetime.fromtimestamp(obs["timestamp"])
            if dt.hour == hour:
                hour_values.append(obs["value"])
        
        if len(hour_values) < 5:
            return None
        
        # Compute global distribution
        global_dist = {
            "p50": float(np.percentile(hour_values, 50)),
            "stddev": float(np.std(hour_values)),
        }
        
        # Try to load AP topology offset
        # This is a simplified version - in production would load from config
        # For now, just return the global distribution without scaling
        # (Can be enhanced later to read config and apply offsets)
        
        return {
            "p1": float(np.percentile(hour_values, 1)),
            "p5": float(np.percentile(hour_values, 5)),
            "p10": float(np.percentile(hour_values, 10)),
            "p25": float(np.percentile(hour_values, 25)),
            "p50": global_dist["p50"],
            "p75": float(np.percentile(hour_values, 75)),
            "p90": float(np.percentile(hour_values, 90)),
            "p95": float(np.percentile(hour_values, 95)),
            "p99": float(np.percentile(hour_values, 99)),
            "mean": float(np.mean(hour_values)),
            "stddev": global_dist["stddev"],
            "count": len(hour_values),
        }
    
    def _synthetic_distribution(self, baseline: float, variance: float) -> Dict:
        """
        Generate a synthetic distribution from config baseline and variance.
        
        Args:
            baseline: Metric baseline value from config
            variance: Absolute variance (typical_variance_pct / 100 * range)
        
        Returns:
            Distribution dict with synthetic percentiles
        """
        # Assume normal distribution: baseline ± variance
        # Generate percentiles assuming N(baseline, variance²)
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
        """
        Load metric configuration from config file.
        
        Args:
            metric: Metric name
        
        Returns:
            Metric config dict or None if not found
        """
        try:
            # Try to load the active config
            config_path = Path("simulator/config_enterprise.json")
            if not config_path.exists():
                return None
            
            with open(config_path, "r") as f:
                config = json.load(f)
            
            return config.get(metric)
        except:
            return None
    
    def close(self) -> None:
        """Close database connection."""
        self.db.close()


# Singleton instance
_store_instance = None

def get_metrics_store(db_path: str = "data/metrics.csv") -> MetricsStore:
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
