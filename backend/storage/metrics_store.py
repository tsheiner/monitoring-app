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
            Dict with percentiles (p5, p25, p50, p75, p95), mean, stddev
            None if no data in range
        """
        observations = self.query_range(metric, start, end)
        
        if not observations:
            return None
        
        values = np.array([obs["value"] for obs in observations])
        
        return {
            "p5": float(np.percentile(values, 5)),
            "p25": float(np.percentile(values, 25)),
            "p50": float(np.percentile(values, 50)),  # median
            "p75": float(np.percentile(values, 75)),
            "p95": float(np.percentile(values, 95)),
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
