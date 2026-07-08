"""Shared aggregation helpers for metric observations."""

from collections import defaultdict
from typing import Dict, Iterable, List, Optional


STATUS_RANK = {"green": 0, "yellow": 1, "red": 2}


def _worst_status(records: Iterable[Dict]) -> str:
    """Return the worst classifier status across contributing records."""
    worst = "green"
    for record in records:
        status = record.get("status", "green")
        if STATUS_RANK.get(status, 0) > STATUS_RANK[worst]:
            worst = status
    return worst


def aggregate_metric_observations(observations: List[Dict]) -> Optional[Dict]:
    """
    Aggregate per-AP observations for one metric and timestamp.

    Semantics:
    - metric value is the arithmetic mean across observations
    - classifier value, contribution, and weight are arithmetic means
    - classifier status is worst-of-APs
    - aggregated entity is represented as null/None
    """
    if not observations:
        return None

    first = observations[0]
    aggregated = {
        "timestamp": first["timestamp"],
        "metric": first["metric"],
        "value": round(
            sum(obs["value"] for obs in observations) / len(observations), 2
        ),
        "entity": None,
    }

    classifier_groups = defaultdict(list)
    for obs in observations:
        for classifier in obs.get("classifiers") or []:
            classifier_groups[classifier["name"]].append(classifier)

    if not classifier_groups:
        return aggregated

    classifiers = []
    for name, group in classifier_groups.items():
        values = [classifier["value"] for classifier in group]
        contributions = [classifier.get("contribution", 0.0) for classifier in group]
        weights = [
            classifier["weight"]
            for classifier in group
            if classifier.get("weight") is not None
        ]

        classifier = {
            "name": name,
            "value": round(sum(values) / len(values), 4),
            "status": _worst_status(group),
            "contribution": round(sum(contributions) / len(contributions), 4),
        }
        if weights:
            classifier["weight"] = round(sum(weights) / len(weights), 4)
        classifiers.append(classifier)

    aggregated["classifiers"] = classifiers
    return aggregated
