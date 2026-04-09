"""
Pytest fixtures for deterministic, isolated backend tests.

Provides:
- Fixed random seeds for reproducibility
- Isolated temp data directories
- Deterministic timestamps
- Generator fixture with seeded initialization
"""
import os
import tempfile
import shutil
from pathlib import Path
from typing import Generator
import pytest
import numpy as np


@pytest.fixture
def deterministic_seed():
    """
    Provide a fixed random seed and reset numpy/random state.
    
    Returns:
        int: Fixed seed value (12345)
    """
    seed = 12345
    np.random.seed(seed)
    return seed


@pytest.fixture
def temp_data_dir():
    """
    Create isolated temporary data directory for each test.
    
    Yields:
        Path: Temporary directory path that will be cleaned up after test
    """
    temp_dir = tempfile.mkdtemp(prefix="monitoring_test_")
    yield Path(temp_dir)
    # Cleanup
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def fixed_timestamp():
    """
    Provide a fixed timestamp for deterministic time-based tests.
    
    Returns:
        int: Unix timestamp (2026-02-01 00:00:00 UTC)
    """
    # Feb 1, 2026, 00:00:00 UTC
    return 1769990400


@pytest.fixture
def seeded_generator(deterministic_seed, temp_data_dir):
    """
    Create a RealisticMetricsGenerator with deterministic seed and isolated data.
    
    Args:
        deterministic_seed: Fixed random seed (used as start_time for RNG seeding)
        temp_data_dir: Isolated data directory
        
    Returns:
        RealisticMetricsGenerator: Initialized generator with deterministic behavior
    """
    from simulator.realistic_generator import RealisticMetricsGenerator
    
    # Generator seeds RNG from start_time, so use deterministic_seed as start_time
    # This gives us reproducible random behavior
    generator = RealisticMetricsGenerator(
        config_path="simulator/config.json",
        start_time=deterministic_seed
    )
    
    return generator


@pytest.fixture
def isolated_metrics_store(temp_data_dir):
    """
    Create a MetricsStore with isolated database path.
    
    Args:
        temp_data_dir: Temporary data directory
        
    Returns:
        MetricsStore: Store instance with temp DB
    """
    from storage.metrics_store import MetricsStore
    
    db_path = temp_data_dir / "metrics.db"
    store = MetricsStore(str(db_path))
    return store


@pytest.fixture
def isolated_events_store(temp_data_dir):
    """
    Create an EventsStore with isolated database path.
    
    Args:
        temp_data_dir: Temporary data directory
        
    Returns:
        EventsStore: Store instance with temp DB
    """
    from storage.events_store import EventsStore
    
    db_path = temp_data_dir / "events.db"
    store = EventsStore(str(db_path))
    return store


@pytest.fixture(autouse=True)
def reset_singleton_state():
    """
    Reset any singleton state between tests to prevent leakage.
    
    This fixture runs automatically for all tests.
    """
    # Reset numpy random state
    np.random.seed(None)
    
    # Clear any module-level caches or singletons
    # (Add specific resets as needed when singletons are identified)
    
    yield
    
    # Post-test cleanup
    np.random.seed(None)
