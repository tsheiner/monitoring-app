"""
Realistic metrics generator using research-based patterns.

Generates WiFi network metrics with:
- Multi-frequency seasonality (daily + hourly + weekly)
- Autocorrelated noise for smoothness
- Metric correlations and cascading effects
- Time-varying distributions
"""
import json
import time
from pathlib import Path
from typing import Dict, List
import numpy as np


class RealisticMetricsGenerator:
    """Generate realistic network metrics with proper time series characteristics."""
    
    def __init__(self, start_time: int = None, config_path: str = None):
        """
        Initialize metrics generator.
        
        Args:
            start_time: Unix timestamp to start from (defaults to current time)
            config_path: Path to config JSON file
        """
        self.start_time = start_time or int(time.time())
        self.current_offset = 0
        
        # Load configuration
        if config_path is None:
            config_path = Path(__file__).parent / "config.json"
        
        with open(config_path, 'r') as f:
            self.config = json.load(f)
        
        # Initialize noise state for autocorrelation (AR process)
        # Each metric maintains its own noise history for smoothness
        self.noise_state = {metric: 0.0 for metric in self.get_all_metrics()}
        
        # Capacity state for correlations
        self.capacity_state = self.config['capacity']['baseline']
        self.health_state = self.config['ap_health']['baseline']
    
    def generate_observation(self, metric: str, timestamp: int = None) -> Dict:
        """
        Generate a single observation for a metric at a timestamp.
        
        Args:
            metric: Metric name
            timestamp: Unix timestamp (defaults to current time)
            
        Returns:
            Observation dict with timestamp, metric, value
        """
        if metric not in self.get_all_metrics():
            raise ValueError(f"Unknown metric: {metric}")
        
        ts = timestamp or (self.start_time + self.current_offset)
        
        # Update correlation states if generating capacity or health
        if metric == 'capacity':
            value = self._compute_value(metric, ts)
            self.capacity_state = value
        elif metric == 'ap_health':
            value = self._compute_value(metric, ts)
            self.health_state = value
        else:
            value = self._compute_value(metric, ts)
        
        return {
            "timestamp": ts,
            "metric": metric,
            "value": round(value, 2)
        }
    
    def _compute_value(self, metric: str, timestamp: int) -> float:
        """
        Compute metric value with realistic time series characteristics.
        
        Uses:
        - Multi-frequency seasonality (daily, hourly, weekly)
        - Autocorrelated noise (AR process)
        - Metric correlations
        """
        cfg = self.config[metric]
        
        # 1. Calculate time-based components
        base = cfg['baseline']
        
        # Daily pattern (24-hour cycle with business hours emphasis)
        daily_component = self._daily_pattern(timestamp, cfg)
        
        # Hourly micro-variations (10-15 minute cycles)
        hourly_component = self._hourly_pattern(timestamp, cfg)
        
        # Weekly pattern
        weekly_component = self._weekly_pattern(timestamp, cfg)
        
        # 2. Combine seasonality
        seasonal_value = base * (1.0 + daily_component + hourly_component + weekly_component)
        
        # 3. Apply correlations (capacity and health effects)
        correlated_value = self._apply_correlations(metric, seasonal_value)
        
        # 4. Add autocorrelated noise for realistic smoothness
        noisy_value = self._add_smooth_noise(metric, correlated_value, cfg)
        
        # 5. Clamp to realistic bounds
        return np.clip(noisy_value, cfg['min'], cfg['max'])
    
    def _daily_pattern(self, timestamp: int, cfg: Dict) -> float:
        """
        Generate daily cycle with business hours emphasis.

        Uses fractional hours for smooth transitions instead of discrete jumps.

        Pattern:
        - Night (11pm-6am): baseline
        - Morning surge (6-9am): gradual ramp up
        - Daytime plateau (9am-4pm): sustained activity with lunch dip
        - Evening decline (4-8pm): gradual drop
        - Late evening (8-11pm): low activity
        """
        # Use fractional hour for smooth transitions
        hour = (timestamp % 86400) / 3600.0

        peak_hour = cfg['peak_hour']
        impact = cfg['business_hours_impact']
        strength = cfg['daily_pattern_strength']

        # Smooth daily curve using sine-based interpolation
        # This creates gradual transitions instead of discrete jumps
        if hour < 6:
            # Night (midnight to 6am): low baseline
            intensity = 0.1
        elif hour < 9:
            # Morning ramp (6am to 9am): smooth rise
            t = (hour - 6) / 3.0  # 0 to 1 over 3 hours
            intensity = 0.1 + 0.7 * (0.5 - 0.5 * np.cos(np.pi * t))
        elif hour < 12:
            # Morning plateau (9am to noon): high with slight variation
            t = (hour - 9) / 3.0
            intensity = 0.8 + 0.05 * np.sin(np.pi * t)
        elif hour < 13:
            # Lunch dip (noon to 1pm): slight decrease
            t = (hour - 12)
            intensity = 0.85 - 0.1 * np.sin(np.pi * t)
        elif hour < 16:
            # Afternoon peak (1pm to 4pm): highest activity
            t = (hour - 13) / 3.0
            base = 0.85 + 0.15 * np.sin(np.pi * t)
            # Peak around configured peak_hour
            peak_factor = np.exp(-((hour - peak_hour) ** 2) / 2)
            intensity = base + 0.05 * peak_factor
        elif hour < 19:
            # Evening decline (4pm to 7pm): smooth drop
            t = (hour - 16) / 3.0  # 0 to 1 over 3 hours
            intensity = 0.85 - 0.55 * (0.5 - 0.5 * np.cos(np.pi * t))
        elif hour < 23:
            # Late evening (7pm to 11pm): gradual fade to night
            t = (hour - 19) / 4.0  # 0 to 1 over 4 hours
            intensity = 0.3 - 0.2 * t
        else:
            # Late night (11pm to midnight): low
            intensity = 0.1

        # Convert intensity to multiplier effect
        component = (impact - 1.0) * intensity * strength

        return component
    
    def _hourly_pattern(self, timestamp: int, cfg: Dict) -> float:
        """Generate hourly micro-variations (10-15 minute cycles)."""
        if not self.config['time_patterns']['hourly_cycles']['enabled']:
            return 0.0
        
        period_seconds = self.config['time_patterns']['hourly_cycles']['period_minutes'] * 60
        amplitude = self.config['time_patterns']['hourly_cycles']['amplitude']
        
        # Multiple harmonics for more realistic variation
        cycle1 = np.sin(2 * np.pi * timestamp / period_seconds)
        cycle2 = 0.3 * np.sin(4 * np.pi * timestamp / period_seconds + 0.5)
        
        return amplitude * (cycle1 + cycle2) * cfg['daily_pattern_strength']
    
    def _weekly_pattern(self, timestamp: int, cfg: Dict) -> float:
        """Generate weekly cycle (weekend reduction)."""
        if not self.config['time_patterns']['weekly_cycles']['enabled']:
            return 0.0
        
        weekday = (timestamp // 86400 + 3) % 7  # 0=Sunday, 6=Saturday
        weekday_multipliers = self.config['time_patterns']['weekly_cycles']['weekday_pattern']
        
        multiplier = weekday_multipliers[weekday]
        strength = cfg['weekly_pattern_strength']
        
        return (multiplier - 1.0) * strength
    
    def _apply_correlations(self, metric: str, value: float) -> float:
        """
        Apply metric correlations (capacity and health effects).
        
        High capacity degrades latency and throughput.
        Low health degrades everything.
        """
        cfg = self.config[metric]
        corr_cfg = self.config['correlation_matrix']
        
        # Skip correlation for capacity and health themselves to avoid circular dependency
        if metric in ['capacity', 'ap_health']:
            return value
        
        # Capacity effects (when capacity > threshold)
        capacity_sensitivity = cfg.get('capacity_sensitivity', 0)
        if capacity_sensitivity != 0:
            capacity_stress = max(0, self.capacity_state - corr_cfg['capacity_degrades_at'])
            capacity_impact = capacity_sensitivity * (capacity_stress / 20.0)  # Scale to 0-1
            value *= (1.0 + capacity_impact)
        
        # Health effects (when health < threshold)
        health_sensitivity = cfg.get('health_sensitivity', 0)
        if health_sensitivity != 0:
            health_degradation = max(0, corr_cfg['health_degrades_at'] - self.health_state)
            health_impact = health_sensitivity * (health_degradation / 25.0)  # Scale to 0-1
            
            # Health degrades performance (lower is worse)
            if metric in ['time_to_connect', 'roaming']:
                # For latency metrics, degradation increases value
                value *= (1.0 + health_impact)
            else:
                # For performance metrics, degradation decreases value
                value *= (1.0 - health_impact * 0.5)
        
        return value
    
    def _add_smooth_noise(self, metric: str, value: float, cfg: Dict) -> float:
        """
        Add autocorrelated noise using AR(1) process.
        
        This creates smooth, realistic variations instead of sawtooth patterns.
        Smoothness parameter controls how much previous noise influences current.
        """
        smoothness = cfg['smoothness']  # 0 = white noise, 1 = perfectly smooth
        variance_pct = cfg['typical_variance_pct'] / 100.0
        
        # Calculate noise scale based on absolute value to handle negative metrics (like dBm)
        noise_scale = variance_pct * abs(value)
        
        # AR(1): new_noise = smoothness * old_noise + (1-smoothness) * random_shock
        random_shock = np.random.normal(0, noise_scale)
        new_noise = smoothness * self.noise_state[metric] + (1 - smoothness) * random_shock
        
        # Update state for next call
        self.noise_state[metric] = new_noise
        
        return value + new_noise
    
    def tick(self, interval_seconds: int = 10) -> None:
        """
        Advance time for the generator.
        
        Args:
            interval_seconds: How much to advance
        """
        self.current_offset += interval_seconds
    
    @classmethod
    def get_all_metrics(cls) -> List[str]:
        """Get list of all available metric names."""
        return [
            "time_to_connect",
            "throughput",
            "coverage",
            "capacity",
            "roaming",
            "successful_connects",
            "ap_health"
        ]


# Singleton instance for easy access
_generator_instance = None

def get_generator(start_time: int = None) -> RealisticMetricsGenerator:
    """Get or create the global metrics generator instance."""
    global _generator_instance
    if _generator_instance is None:
        _generator_instance = RealisticMetricsGenerator(start_time)
    return _generator_instance

def reset_generator() -> None:
    """Reset the singleton instance (useful after bootstrap)."""
    global _generator_instance
    _generator_instance = None


def reset_for_live_streaming() -> None:
    """
    Reset generator for live streaming while preserving noise state.

    After bootstrap, the generator has start_time from days ago.
    This resets start_time to now while keeping the noise state
    so live data flows smoothly from historical data.
    """
    global _generator_instance
    if _generator_instance is not None:
        # Preserve the noise state for continuity
        preserved_noise = _generator_instance.noise_state.copy()
        preserved_capacity = _generator_instance.capacity_state
        preserved_health = _generator_instance.health_state

        # Create new instance starting from now
        _generator_instance = RealisticMetricsGenerator(start_time=int(time.time()))

        # Restore the noise state
        _generator_instance.noise_state = preserved_noise
        _generator_instance.capacity_state = preserved_capacity
        _generator_instance.health_state = preserved_health
