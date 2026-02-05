"""
TinyFlux wrapper for metrics storage.

Stores time-series observations and provides range queries with distribution computation.
"""
import os
from typing import List, Dict, Optional
from pathlib import Path
from datetime import datetime

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
    
    def insert_observation(self, observation: Dict) -> None:
        """
        Insert a single metric observation.
        
        Args:
            observation: Dict with timestamp, metric, value
        """
        point = Point(
            time=datetime.fromtimestamp(observation["timestamp"]),
            tags={"metric": observation["metric"]},
            fields={"value": observation["value"]}
        )
        self.db.insert(point)
    
    def insert_batch(self, observations: List[Dict]) -> None:
        """
        Insert multiple observations efficiently.
        
        Args:
            observations: List of observation dicts
        """
        points = [
            Point(
                time=datetime.fromtimestamp(obs["timestamp"]),
                tags={"metric": obs["metric"]},
                fields={"value": obs["value"]}
            )
            for obs in observations
        ]
        self.db.insert_multiple(points)
    
    def query_range(
        self,
        metric: str,
        start: int,
        end: int
    ) -> List[Dict]:
        """
        Query observations in a time range.
        
        Args:
            metric: Metric name
            start: Start timestamp (inclusive)
            end: End timestamp (inclusive)
            
        Returns:
            List of observation dicts sorted by timestamp
        """
        Tag = TagQuery()
        Time = TimeQuery()
        
        # Convert Unix timestamps to datetime for TinyFlux
        start_dt = datetime.fromtimestamp(start)
        end_dt = datetime.fromtimestamp(end)
        
        results = self.db.search(
            (Tag.metric == metric) & 
            (Time >= start_dt) & 
            (Time <= end_dt)
        )
        
        observations = [
            {
                "timestamp": int(point.time.timestamp()),
                "metric": metric,
                "value": point.fields["value"]
            }
            for point in results
        ]
        
        # Sort by timestamp
        observations.sort(key=lambda x: x["timestamp"])
        
        return observations
    
    def compute_distribution(
        self,
        metric: str,
        start: int,
        end: int
    ) -> Optional[Dict]:
        """
        Compute statistical distribution for metric in time range.
        
        Args:
            metric: Metric name
            start: Start timestamp
            end: End timestamp
            
        Returns:
            Dict with percentiles (p1, p5, p10, p25, p50, p75, p90, p95, p99), mean, stddev
            None if no data in range
        """
        observations = self.query_range(metric, start, end)
        
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
    
    def compute_distribution_series(
        self,
        metric: str,
        start: int,
        end: int,
        bucket_size: int
    ) -> List[Dict]:
        """
        Compute time-bucketed distribution series.
        
        Returns distributions computed over time windows, allowing
        the distribution to vary across the time range.
        
        Args:
            metric: Metric name
            start: Start timestamp
            end: End timestamp
            bucket_size: Size of each bucket in seconds
            
        Returns:
            List of dicts with 'timestamp' (bucket center) and 'distribution'
        """
        # Get all observations in range
        observations = self.query_range(metric, start, end)
        
        if not observations:
            return []
        
        # Group observations into buckets
        buckets: Dict[int, List[float]] = {}
        
        for obs in observations:
            # Determine which bucket this observation belongs to
            bucket_start = (obs["timestamp"] // bucket_size) * bucket_size
            bucket_center = bucket_start + bucket_size // 2
            
            if bucket_center not in buckets:
                buckets[bucket_center] = []
            
            buckets[bucket_center].append(obs["value"])
        
        # Compute distribution for each bucket
        result = []
        for timestamp in sorted(buckets.keys()):
            values = np.array(buckets[timestamp])
            
            if len(values) >= 2:  # Need at least 2 points for meaningful distribution
                dist = {
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
                    "count": len(values)
                }
                
                result.append({
                    "timestamp": timestamp,
                    "distribution": dist
                })
        
        return result
    
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
        
        observations = [
            {
                "timestamp": int(point.time.timestamp()),
                "metric": metric,
                "value": point.fields["value"]
            }
            for point in results
        ]
        
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
