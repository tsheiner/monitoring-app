"""Tests for canonical simulator frame generation."""

from simulator.realistic_generator import RealisticMetricsGenerator


def _values_by_metric(frame):
    return {observation["metric"]: observation["value"] for observation in frame}


def test_generate_observation_matches_metric_frame(fixed_timestamp):
    """Single-metric compatibility calls match the canonical frame path."""
    metric_names = RealisticMetricsGenerator.get_all_metrics()

    frame_generator = RealisticMetricsGenerator(
        config_path="simulator/config.json",
        start_time=12345,
    )
    frame_values = _values_by_metric(
        frame_generator.generate_metric_frame(
            timestamp=fixed_timestamp,
            entity="AP-Floor1-01",
            include_classifiers=True,
        )
    )

    single_generator = RealisticMetricsGenerator(
        config_path="simulator/config.json",
        start_time=12345,
    )
    single_values = {}
    for metric in metric_names:
        observation = single_generator.generate_observation(
            metric,
            timestamp=fixed_timestamp,
            entity="AP-Floor1-01",
            include_classifiers=True,
        )
        single_values[metric] = observation["value"]

    assert single_values == frame_values


def test_metric_order_does_not_change_frame_values(fixed_timestamp):
    """All metrics in a frame derive from one state snapshot."""
    metric_names = RealisticMetricsGenerator.get_all_metrics()

    normal_generator = RealisticMetricsGenerator(
        config_path="simulator/config.json",
        start_time=12345,
    )
    reversed_generator = RealisticMetricsGenerator(
        config_path="simulator/config.json",
        start_time=12345,
    )

    normal_frame = normal_generator.generate_metric_frame(
        timestamp=fixed_timestamp,
        entity="AP-Floor1-01",
        metrics=metric_names,
    )
    reversed_frame = reversed_generator.generate_metric_frame(
        timestamp=fixed_timestamp,
        entity="AP-Floor1-01",
        metrics=list(reversed(metric_names)),
    )

    assert _values_by_metric(normal_frame) == _values_by_metric(reversed_frame)


def test_ap_order_does_not_change_values(fixed_timestamp):
    """AP values are stable regardless of iteration order."""
    ap_names = ["AP-Floor1-01", "AP-Floor2-01", "AP-Floor3-01"]
    timestamps = [fixed_timestamp + i * 30 for i in range(5)]

    forward_generator = RealisticMetricsGenerator(
        config_path="simulator/config.json",
        start_time=12345,
    )
    reverse_generator = RealisticMetricsGenerator(
        config_path="simulator/config.json",
        start_time=12345,
    )

    forward_values = {}
    for timestamp in timestamps:
        for ap in ap_names:
            frame = forward_generator.generate_metric_frame(
                timestamp=timestamp,
                entity=ap,
            )
            forward_values[(timestamp, ap)] = _values_by_metric(frame)

    reverse_values = {}
    for timestamp in timestamps:
        for ap in reversed(ap_names):
            frame = reverse_generator.generate_metric_frame(
                timestamp=timestamp,
                entity=ap,
            )
            reverse_values[(timestamp, ap)] = _values_by_metric(frame)

    assert reverse_values == forward_values


def test_classifier_breakdowns_use_frame_snapshot(fixed_timestamp):
    """Classifiers attached to each metric come from the frame state."""
    generator = RealisticMetricsGenerator(
        config_path="simulator/config.json",
        start_time=12345,
    )

    frame = generator.generate_metric_frame(
        timestamp=fixed_timestamp,
        entity="AP-Floor1-01",
        include_classifiers=True,
    )

    successful_connects = next(
        observation
        for observation in frame
        if observation["metric"] == "successful_connects"
    )
    time_to_connect = next(
        observation for observation in frame if observation["metric"] == "time_to_connect"
    )

    successful_classifier_values = {
        classifier["name"]: classifier["value"]
        for classifier in successful_connects["classifiers"]
    }
    time_classifier_values = {
        classifier["name"]: classifier["value"]
        for classifier in time_to_connect["classifiers"]
    }

    assert successful_classifier_values == time_classifier_values
