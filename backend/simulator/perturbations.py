"""
Perturbation system for event-classifier causality.

Perturbations are temporary, decaying effects on CLASSIFIERS caused by events
or usage patterns. Since metrics are derived from classifiers, perturbing a
single classifier naturally cascades to all affected metrics.

Classifiers represent infrastructure sub-components (e.g., dhcp, dns, association).
Each classifier has:
- Value (0-1, where 1 = perfect/healthy)
- Its own OU process for natural variation
- Status thresholds (green/yellow/red)

Each perturbation defines:
- Which classifiers are affected and by how much
- How the effect decays over time
- Duration of the effect

The PerturbationManager tracks all active perturbations and computes
their combined effect on any classifier at any timestamp.
"""
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from simulator.event_catalog import (
    build_legacy_perturbation_templates,
    get_perturbation_policy,
    normalize_event_type,
)


@dataclass
class Perturbation:
    """A temporary effect on one or more classifiers."""

    start_time: int  # Unix timestamp when perturbation begins
    duration_seconds: int  # How long the full effect lasts
    affected_classifiers: Dict[str, float]  # classifier_name -> magnitude (additive)
    decay_type: str = "exponential"  # exponential, linear, sudden_recovery, gradual_improvement
    source_event_type: str = ""  # What caused this perturbation
    source_entity: str = ""  # Which entity is affected

    def effect_at(self, classifier: str, timestamp: int) -> float:
        """
        Compute the effect of this perturbation on a classifier at a given time.

        Returns 0.0 if the classifier isn't affected or the perturbation has expired.
        """
        if classifier not in self.affected_classifiers:
            return 0.0

        elapsed = timestamp - self.start_time
        if elapsed < 0 or elapsed > self.duration_seconds:
            return 0.0

        magnitude = self.affected_classifiers[classifier]
        progress = elapsed / self.duration_seconds  # 0.0 to 1.0

        if self.decay_type == "exponential":
            # Fast initial impact, gradual recovery
            decay = math.exp(-3.0 * progress)
        elif self.decay_type == "linear":
            decay = 1.0 - progress
        elif self.decay_type == "sudden_recovery":
            # Full effect for 80% of duration, then rapid recovery
            if progress < 0.8:
                decay = 1.0
            else:
                decay = 1.0 - (progress - 0.8) / 0.2
        elif self.decay_type == "gradual_improvement":
            # Starts at 0, ramps to full magnitude (for ai_action positive effects)
            decay = progress
        else:
            decay = 1.0 - progress  # default to linear

        return magnitude * decay

    def is_expired(self, timestamp: int) -> bool:
        """Check if this perturbation has fully expired."""
        return (timestamp - self.start_time) > self.duration_seconds


class PerturbationManager:
    """
    Tracks active perturbations and computes their combined effect.

    Usage:
        manager = PerturbationManager()
        manager.add(perturbation)
        effect = manager.total_effect("infra_health", timestamp)
    """

    def __init__(self):
        self._active: List[Perturbation] = []

    def add(self, perturbation: Perturbation) -> None:
        """Add a new perturbation."""
        self._active.append(perturbation)

    def total_effect(self, classifier: str, timestamp: int, entity: str = None) -> float:
        """
        Compute the combined effect of all active perturbations on a classifier.

        Args:
            classifier: Classifier name (e.g., dhcp, dns, association)
            timestamp: Current timestamp
            entity: Optional entity filter. If provided, only includes
                    perturbations for this entity or global perturbations.

        Returns the sum of all perturbation effects (additive).
        Also cleans up expired perturbations.
        """
        total = 0.0
        still_active = []

        for p in self._active:
            if p.is_expired(timestamp):
                continue
            still_active.append(p)

            # Entity filtering: skip perturbations for other entities
            if entity is not None and p.source_entity and p.source_entity != entity:
                continue

            total += p.effect_at(classifier, timestamp)

        self._active = still_active
        return total

    def has_active_perturbations(self, timestamp: int) -> bool:
        """Check if there are any active perturbations."""
        return any(not p.is_expired(timestamp) for p in self._active)

    def clear(self) -> None:
        """Remove all perturbations."""
        self._active.clear()

    @property
    def active_count(self) -> int:
        return len(self._active)


# --- Perturbation Templates ---
# These affect CLASSIFIERS (infrastructure sub-components).
# A single classifier perturbation naturally cascades to all metrics
# that reference that classifier.
#
# Classifiers are flat, shared names (e.g., 'dhcp', not 'successful_connects.dhcp')

PERTURBATION_TEMPLATES = build_legacy_perturbation_templates()


LOAD_PATTERN_TEMPLATES = {
    "meeting_room_surge": {
        "affected_classifiers": {
            "client_load": 0.15,     # Conference room fills up
        },
        "duration_seconds": 2400,    # 40 minutes
        "decay_type": "sudden_recovery",
    },
    "large_download": {
        "affected_classifiers": {
            "client_load": 0.10,     # Bandwidth-heavy transfer
        },
        "duration_seconds": 600,     # 10 minutes
        "decay_type": "sudden_recovery",
    },
    "shift_change": {
        "affected_classifiers": {
            "client_load": 0.12,     # Wave of reconnections
        },
        "duration_seconds": 1200,    # 20 minutes
        "decay_type": "linear",
    },
}


def create_load_perturbation(pattern_name: str, timestamp: int) -> Optional[Perturbation]:
    """Create a perturbation from a load pattern template."""
    template = LOAD_PATTERN_TEMPLATES.get(pattern_name)
    if template is None:
        return None

    return Perturbation(
        start_time=timestamp,
        duration_seconds=template["duration_seconds"],
        affected_classifiers=dict(template["affected_classifiers"]),
        decay_type=template["decay_type"],
        source_event_type=f"load:{pattern_name}",
        source_entity="",
    )


def create_perturbation_from_event(event: Dict) -> Optional[Perturbation]:
    """
    Create a perturbation from an event dict.

    Returns None if the event type has no perturbation template.
    """
    event_type = normalize_event_type(event.get("event_type", ""))
    template = get_perturbation_policy(event_type, event.get("severity"))

    if template is None:
        return None

    return Perturbation(
        start_time=event.get("timestamp", 0),
        duration_seconds=template["duration_seconds"],
        affected_classifiers=dict(template["affected_classifiers"]),
        decay_type=template["decay_type"],
        source_event_type=event_type,
        source_entity=event.get("entity", ""),
    )
