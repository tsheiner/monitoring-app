"""Scenario definitions and runtime scheduling for catalog-backed events."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple
import uuid

from simulator.event_catalog import get_event_definition, get_perturbation_policy


SCENARIO_SEVERITIES = ("warning", "critical")


@dataclass(frozen=True)
class ScenarioStep:
    offset_seconds: int
    event_type: str
    description: str
    severity: Optional[str] = None
    entity_selector: str = "target"
    metadata: Dict = field(default_factory=dict)

    def event_severity(self, scenario_severity: str) -> str:
        definition = get_event_definition(self.event_type)
        if definition is None:
            raise ValueError(f"Unknown event type in scenario: {self.event_type}")
        if self.severity is not None:
            return definition.normalize_severity(self.severity)
        if scenario_severity in definition.severity_choices:
            return scenario_severity
        if "warning" in definition.severity_choices:
            return "warning"
        if "info" in definition.severity_choices:
            return "info"
        return definition.default_severity


@dataclass(frozen=True)
class ScenarioDefinition:
    scenario_id: str
    label: str
    description: str
    steps: Tuple[ScenarioStep, ...]
    default_severity: str = "warning"
    allowed_severities: Tuple[str, ...] = SCENARIO_SEVERITIES

    def estimated_duration_seconds(self, severity: str) -> int:
        duration = 0
        for step in self.steps:
            step_severity = step.event_severity(severity)
            policy = get_perturbation_policy(step.event_type, step_severity)
            recovery = policy["duration_seconds"] if policy else 0
            duration = max(duration, step.offset_seconds + recovery)
        return duration

    def to_dict(self) -> Dict:
        return {
            "scenario_id": self.scenario_id,
            "label": self.label,
            "description": self.description,
            "default_severity": self.default_severity,
            "allowed_severities": list(self.allowed_severities),
            "steps": [
                {
                    "offset_seconds": step.offset_seconds,
                    "event_type": step.event_type,
                    "severity": step.severity,
                    "entity_selector": step.entity_selector,
                    "description": step.description,
                }
                for step in self.steps
            ],
        }


@dataclass
class ScenarioRun:
    scenario_run_id: str
    scenario_id: str
    entity: str
    severity: str
    started_at: int
    ends_at: int
    emitted_step_indexes: Set[int] = field(default_factory=set)


@dataclass(frozen=True)
class DueScenarioEvent:
    run: ScenarioRun
    scenario: ScenarioDefinition
    step: ScenarioStep
    step_index: int
    scheduled_at: int
    event_severity: str
    entity: str

    def metadata(self) -> Dict:
        metadata = dict(self.step.metadata)
        metadata.update(
            {
                "scenario_id": self.run.scenario_id,
                "scenario_run_id": self.run.scenario_run_id,
                "scenario_label": self.scenario.label,
                "scenario_step": self.step_index,
            }
        )
        return metadata


SCENARIO_DEFINITIONS: Dict[str, ScenarioDefinition] = {
    "dhcp_outage": ScenarioDefinition(
        scenario_id="dhcp_outage",
        label="DHCP Outage",
        description="Lease acquisition failures begin, are investigated, then recover.",
        default_severity="critical",
        steps=(
            ScenarioStep(
                offset_seconds=0,
                event_type="dhcp_server_overload",
                description="DHCP lease failures start on the target AP.",
                metadata={"phase": "impact"},
            ),
            ScenarioStep(
                offset_seconds=180,
                event_type="dns_resolution_failure",
                description="Client retries create DNS lookup pressure.",
                severity="warning",
                metadata={"phase": "secondary_symptom"},
            ),
            ScenarioStep(
                offset_seconds=420,
                event_type="config_change",
                description="Network team applies DHCP scope remediation.",
                severity="info",
                metadata={"phase": "remediation"},
            ),
            ScenarioStep(
                offset_seconds=720,
                event_type="ai_action",
                description="AI assistant confirms recovery optimization.",
                severity="info",
                metadata={"phase": "recovery"},
            ),
        ),
    ),
    "major_switch_failure": ScenarioDefinition(
        scenario_id="major_switch_failure",
        label="Major Switch Failure",
        description="A distribution switch failure causes AP instability and client redistribution.",
        default_severity="critical",
        steps=(
            ScenarioStep(
                offset_seconds=0,
                event_type="device_crash",
                description="Target infrastructure crashes and restarts.",
                severity="critical",
                metadata={"phase": "impact"},
            ),
            ScenarioStep(
                offset_seconds=120,
                event_type="high_density_event",
                description="Clients redistribute onto neighboring radios.",
                metadata={"phase": "redistribution"},
            ),
            ScenarioStep(
                offset_seconds=420,
                event_type="device_restart",
                description="Device returns after failover.",
                severity="warning",
                metadata={"phase": "recovery"},
            ),
            ScenarioStep(
                offset_seconds=660,
                event_type="ai_action",
                description="AI balances clients after failover.",
                severity="info",
                metadata={"phase": "optimization"},
            ),
        ),
    ),
    "rogue_ap_attack": ScenarioDefinition(
        scenario_id="rogue_ap_attack",
        label="Rogue AP Attack",
        description="A rogue AP introduces interference and security pressure until mitigated.",
        default_severity="critical",
        steps=(
            ScenarioStep(
                offset_seconds=0,
                event_type="rogue_ap",
                description="Rogue AP is detected near the target.",
                metadata={"phase": "detection"},
            ),
            ScenarioStep(
                offset_seconds=150,
                event_type="interference_event",
                description="RF contention rises around affected clients.",
                metadata={"phase": "impact"},
            ),
            ScenarioStep(
                offset_seconds=480,
                event_type="channel_change",
                description="Channel plan is adjusted to isolate impact.",
                severity="warning",
                metadata={"phase": "mitigation"},
            ),
            ScenarioStep(
                offset_seconds=780,
                event_type="ai_action",
                description="AI validates RF stabilization.",
                severity="info",
                metadata={"phase": "recovery"},
            ),
        ),
    ),
    "firmware_rollout_failure": ScenarioDefinition(
        scenario_id="firmware_rollout_failure",
        label="Firmware Rollout Failure",
        description="A bad rollout causes restart instability and rollback remediation.",
        default_severity="warning",
        steps=(
            ScenarioStep(
                offset_seconds=0,
                event_type="firmware_update",
                description="Firmware rollout begins on the target.",
                severity="warning",
                metadata={"phase": "rollout"},
            ),
            ScenarioStep(
                offset_seconds=180,
                event_type="device_restart",
                description="AP restarts unexpectedly after upgrade.",
                severity="critical",
                metadata={"phase": "failure"},
            ),
            ScenarioStep(
                offset_seconds=420,
                event_type="config_change",
                description="Rollback configuration is applied.",
                severity="info",
                metadata={"phase": "rollback"},
            ),
            ScenarioStep(
                offset_seconds=720,
                event_type="ai_action",
                description="AI confirms post-rollback stability.",
                severity="info",
                metadata={"phase": "recovery"},
            ),
        ),
    ),
    "high_density_surge": ScenarioDefinition(
        scenario_id="high_density_surge",
        label="High-Density Surge",
        description="A crowd surge drives RF contention, DHCP pressure, and recovery tuning.",
        default_severity="warning",
        steps=(
            ScenarioStep(
                offset_seconds=0,
                event_type="high_density_event",
                description="Client density rises sharply.",
                metadata={"phase": "surge"},
            ),
            ScenarioStep(
                offset_seconds=180,
                event_type="dhcp_server_overload",
                description="New joins create DHCP queue pressure.",
                severity="warning",
                metadata={"phase": "secondary_symptom"},
            ),
            ScenarioStep(
                offset_seconds=300,
                event_type="interference_event",
                description="Airtime contention and retries increase.",
                severity="warning",
                metadata={"phase": "rf_contention"},
            ),
            ScenarioStep(
                offset_seconds=900,
                event_type="ai_action",
                description="AI load-balances clients across APs.",
                severity="info",
                metadata={"phase": "recovery"},
            ),
        ),
    ),
}


class ScenarioManager:
    """Track active scenario runs and expose due catalog events."""

    def __init__(self, definitions: Dict[str, ScenarioDefinition] = None):
        self._definitions = definitions or SCENARIO_DEFINITIONS
        self._active_runs: Dict[str, ScenarioRun] = {}

    def list_scenarios(self) -> List[Dict]:
        return [definition.to_dict() for definition in self._definitions.values()]

    def get_definition(self, scenario_id: str) -> Optional[ScenarioDefinition]:
        return self._definitions.get(scenario_id)

    def trigger(
        self,
        scenario_id: str,
        *,
        entity: str,
        severity: str,
        started_at: int,
    ) -> ScenarioRun:
        definition = self.get_definition(scenario_id)
        if definition is None:
            raise KeyError(scenario_id)
        if severity not in definition.allowed_severities:
            raise ValueError(f"Invalid scenario severity: {severity}")

        run = ScenarioRun(
            scenario_run_id=f"scn_{uuid.uuid4().hex[:12]}",
            scenario_id=scenario_id,
            entity=entity,
            severity=severity,
            started_at=started_at,
            ends_at=started_at + definition.estimated_duration_seconds(severity),
        )
        self._active_runs[run.scenario_run_id] = run
        return run

    def due_events(self, current_time: int) -> List[DueScenarioEvent]:
        due: List[DueScenarioEvent] = []

        for run in list(self._active_runs.values()):
            definition = self._definitions[run.scenario_id]
            for index, step in enumerate(definition.steps):
                if index in run.emitted_step_indexes:
                    continue
                scheduled_at = run.started_at + step.offset_seconds
                if scheduled_at > current_time:
                    continue
                run.emitted_step_indexes.add(index)
                due.append(
                    DueScenarioEvent(
                        run=run,
                        scenario=definition,
                        step=step,
                        step_index=index,
                        scheduled_at=scheduled_at,
                        event_severity=step.event_severity(run.severity),
                        entity=self._resolve_entity(step.entity_selector, run.entity),
                    )
                )

        self._expire_runs(current_time)
        return sorted(due, key=lambda event: (event.scheduled_at, event.step_index))

    def active_runs(self, current_time: int) -> List[Dict]:
        self._expire_runs(current_time)
        runs = []
        for run in self._active_runs.values():
            definition = self._definitions[run.scenario_id]
            runs.append(self._run_to_dict(run, definition))
        return sorted(runs, key=lambda run: run["started_at"])

    def scheduled_events_for_run(self, run: ScenarioRun) -> List[Dict]:
        definition = self._definitions[run.scenario_id]
        return [
            {
                "scheduled_at": run.started_at + step.offset_seconds,
                "offset_seconds": step.offset_seconds,
                "event_type": step.event_type,
                "severity": step.event_severity(run.severity),
                "entity": self._resolve_entity(step.entity_selector, run.entity),
                "description": step.description,
            }
            for step in definition.steps
        ]

    def _run_to_dict(self, run: ScenarioRun, definition: ScenarioDefinition) -> Dict:
        return {
            "scenario_run_id": run.scenario_run_id,
            "scenario_id": run.scenario_id,
            "label": definition.label,
            "entity": run.entity,
            "severity": run.severity,
            "started_at": run.started_at,
            "ends_at": run.ends_at,
            "status": "active",
            "emitted_count": len(run.emitted_step_indexes),
            "total_events": len(definition.steps),
            "scheduled_events": self.scheduled_events_for_run(run),
        }

    def _expire_runs(self, current_time: int) -> None:
        expired = [
            run_id
            for run_id, run in self._active_runs.items()
            if current_time > run.ends_at
            and len(run.emitted_step_indexes)
            == len(self._definitions[run.scenario_id].steps)
        ]
        for run_id in expired:
            del self._active_runs[run_id]

    def _resolve_entity(self, selector: str, target_entity: str) -> str:
        if selector == "target":
            return target_entity
        return target_entity

    def reset(self) -> None:
        self._active_runs.clear()
