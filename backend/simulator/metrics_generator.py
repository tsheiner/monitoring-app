"""
Metrics generator using Darts for realistic time series with seasonality.

Generates 7 network health metrics with daily/weekly patterns and realistic noise.
"""
import time
from typing import Dict, List
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from darts import TimeSeries
from darts.models import ExponentialSmoothing
from darts.utils.timeseries_generation import (
    datetime_attribute_timeseries,
    sine_timeseries,
    gaussian_timeseries
)


class MetricsGenerator:
    """Generate realistic network metrics with seasonality."""
    
    # Metric configurations: (baseline, amplitude, noise_level, min_val, max_val)
    METRICS_CONFIG = {
        "time_to_connect": {
            "baseline": 50,      # ms
            "amplitude": 20,     # daily variation
            "noise": 10,         # random noise
            "min": 15,
            "max": 200,
        },
        "throughput": {
            "baseline": 300,     # Mbps
            "amplitude": 150,    # daily variation
            "noise": 50,
            "min": 50,
            "max": 1000,
        },
        "coverage": {
            "baseline": -60,     # dBm
            "amplitude": 10,     # daily variation
            "noise": 5,
            "min": -90,
            "max": -30,
        },
        "capacity": {
            "baseline": 45,      # %
            "amplitude": 25,     # daily variation
            "noise": 10,
            "min": 5,
            "max": 95,
        },
        "roaming": {
            "baseline": 100,     # ms
            "amplitude": 50,     # daily variation
            "noise": 30,
            "min": 10,
            "max": 500,
        },
        "successful_connects": {
            "baseline": 98,      # %
            "amplitude": 3,      # daily variation
            "noise": 1,
            "min": 85,
            "max": 100,
        },
        "ap_health": {
            "baseline": 90,      # score
            "amplitude": 10,     # daily variation
            "noise": 5,
            "min": 40,
            "max": 100,
        }
    }
    
    def __init__(self, start_time: int = None):
        """
        Initialize metrics generator.
        
        Args:
            start_time: Unix timestamp to start from (defaults to current time)
        """
        self.start_time = start_time or int(time.time())
        self.current_offset = 0
        
    def generate_observation(self, metric: str, timestamp: int = None) -> Dict:
        """
        Generate a single observation for a metric at a timestamp.
        
        Args:
            metric: Metric name
            timestamp: Unix timestamp (defaults to current time)
            
        Returns:
            Observation dict with timestamp, metric, value
        """
        if metric not in self.METRICS_CONFIG:
            raise ValueError(f"Unknown metric: {metric}")
        
        ts = timestamp or (self.start_time + self.current_offset)
        value = self._compute_value(metric, ts)
        
        return {
            "timestamp": ts,
            "metric": metric,
            "value": round(value, 2)
        }
    
    def generate_historical(
        self, 
        metric: str, 
        hours: int = 24,
        interval_seconds: int = 10
    ) -> List[Dict]:
        """
        Generate historical observations for a metric.
        
        Args:
            metric: Metric name
            hours: Number of hours of history
            interval_seconds: Time between observations
            
        Returns:
            List of observation dicts
        """
        if metric not in self.METRICS_CONFIG:
            raise ValueError(f"Unknown metric: {metric}")
        
        observations = []
        num_points = int(hours * 3600 / interval_seconds)
        start = self.start_time - (hours * 3600)
        
        for i in range(num_points):
            ts = start + (i * interval_seconds)
            value = self._compute_value(metric, ts)
            observations.append({
                "timestamp": ts,
                "metric": metric,
                "value": round(value, 2)
            })
        
        return observations
    
    def _compute_value(self, metric: str, timestamp: int) -> float:
        """
        Compute metric value at a specific timestamp with seasonality.
        
        Uses sine waves for daily/weekly patterns plus Gaussian noise.
        """
        config = self.METRICS_CONFIG[metric]
        
        # Time-based components
        hour_of_day = (timestamp % 86400) / 86400  # 0-1
        day_of_week = ((timestamp // 86400) % 7) / 7  # 0-1
        
        # Daily seasonality (peak during business hours 9am-5pm)
        # Shift sine wave so peak is around 0.5 (noon)
        daily_component = np.sin((hour_of_day - 0.25) * 2 * np.pi) * config["amplitude"]
        
        # Weekly seasonality (lower on weekends)
        # Weekdays (0-4) higher, weekends (5-6) lower
        weekend_factor = 1.0 if day_of_week < 0.71 else 0.5  # 5/7 = 0.71
        
        # Random noise
        noise = np.random.normal(0, config["noise"])
        
        # Combine components
        value = config["baseline"] + (daily_component * weekend_factor) + noise
        
        # Clamp to valid range
        value = max(config["min"], min(config["max"], value))
        
        return value
    
    def inject_anomaly(
        self, 
        metric: str, 
        timestamp: int,
        magnitude: float = 2.0,
        direction: str = "spike"
    ) -> Dict:
        """
        Generate an anomalous observation.
        
        Args:
            metric: Metric name
            timestamp: When anomaly occurs
            magnitude: How many stddevs from normal (default 2.0)
            direction: "spike" (higher) or "drop" (lower)
            
        Returns:
            Anomalous observation dict
        """
        normal_obs = self.generate_observation(metric, timestamp)
        config = self.METRICS_CONFIG[metric]
        
        # Apply anomaly
        delta = config["noise"] * magnitude
        if direction == "spike":
            normal_obs["value"] = min(config["max"], normal_obs["value"] + delta)
        else:  # drop
            normal_obs["value"] = max(config["min"], normal_obs["value"] - delta)
        
        return normal_obs
    
    def tick(self, interval_seconds: int = 10) -> None:
        """
        Advance internal time offset.
        
        Args:
            interval_seconds: How much to advance
        """
        self.current_offset += interval_seconds
    
    @classmethod
    def get_all_metrics(cls) -> List[str]:
        """Get list of all available metric names."""
        return list(cls.METRICS_CONFIG.keys())


# Singleton instance for easy access
_generator_instance = None

def get_generator(start_time: int = None) -> MetricsGenerator:
    """Get or create the global metrics generator instance."""
    global _generator_instance
    if _generator_instance is None:
        _generator_instance = MetricsGenerator(start_time)
    return _generator_instance

def reset_generator() -> None:
    """Reset the singleton instance (useful after bootstrap)."""
    global _generator_instance
    _generator_instance = None
