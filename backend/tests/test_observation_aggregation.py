"""Tests for shared AP observation aggregation."""

from server.aggregation import aggregate_metric_observations


def test_aggregate_metric_observations_averages_values_and_classifiers():
    observations = [
        {
            "timestamp": 123,
            "metric": "throughput",
            "entity": "AP-1",
            "value": 80.0,
            "classifiers": [
                {
                    "name": "retry_rate",
                    "value": 0.8,
                    "status": "green",
                    "contribution": -0.02,
                    "weight": 0.25,
                }
            ],
        },
        {
            "timestamp": 123,
            "metric": "throughput",
            "entity": "AP-2",
            "value": 70.0,
            "classifiers": [
                {
                    "name": "retry_rate",
                    "value": 0.6,
                    "status": "yellow",
                    "contribution": -0.08,
                    "weight": 0.25,
                }
            ],
        },
    ]

    aggregated = aggregate_metric_observations(observations)

    assert aggregated == {
        "timestamp": 123,
        "metric": "throughput",
        "value": 75.0,
        "entity": None,
        "classifiers": [
            {
                "name": "retry_rate",
                "value": 0.7,
                "status": "yellow",
                "contribution": -0.05,
                "weight": 0.25,
            }
        ],
    }


def test_aggregate_metric_observations_uses_worst_classifier_status():
    observations = [
        {
            "timestamp": 123,
            "metric": "capacity",
            "value": 90.0,
            "classifiers": [
                {
                    "name": "cca_busy",
                    "value": 0.9,
                    "status": "green",
                    "contribution": 0.01,
                }
            ],
        },
        {
            "timestamp": 123,
            "metric": "capacity",
            "value": 60.0,
            "classifiers": [
                {
                    "name": "cca_busy",
                    "value": 0.4,
                    "status": "red",
                    "contribution": -0.12,
                }
            ],
        },
        {
            "timestamp": 123,
            "metric": "capacity",
            "value": 80.0,
            "classifiers": [
                {
                    "name": "cca_busy",
                    "value": 0.7,
                    "status": "yellow",
                    "contribution": -0.03,
                }
            ],
        },
    ]

    aggregated = aggregate_metric_observations(observations)

    assert aggregated["classifiers"][0]["status"] == "red"


def test_aggregate_metric_observations_omits_classifiers_when_missing():
    observations = [
        {
            "timestamp": 123,
            "metric": "coverage",
            "entity": "AP-1",
            "value": -55.0,
        },
        {
            "timestamp": 123,
            "metric": "coverage",
            "entity": "AP-2",
            "value": -57.0,
        },
    ]

    aggregated = aggregate_metric_observations(observations)

    assert aggregated == {
        "timestamp": 123,
        "metric": "coverage",
        "value": -56.0,
        "entity": None,
    }
