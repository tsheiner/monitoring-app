#!/usr/bin/env python
"""
Quick test to verify causal architecture implementation.
Tests that metrics emerge from classifiers with proper alignment.
"""
import time
from simulator.realistic_generator import get_generator, get_classifier_target

def test_causal_architecture():
    print("=" * 70)
    print("Testing Causal Architecture Implementation")
    print("=" * 70)

    # Get generator
    generator = get_generator(start_time=int(time.time()) - 3600)  # 1 hour ago

    # Generate observations at different times of day
    print("\n1. Testing Load-Response Functions:")
    print("-" * 70)

    # Test at different client loads
    for load in [0.2, 0.5, 0.8]:
        dhcp_target = get_classifier_target("dhcp", load)
        auth_target = get_classifier_target("authorization", load)
        density_target = get_classifier_target("client_density", load)

        print(f"\nClient Load: {load:.1f}")
        print(f"  dhcp target: {dhcp_target:.3f}")
        print(f"  authorization target: {auth_target:.3f}")
        print(f"  client_density target: {density_target:.3f}")

    # Generate some observations
    print("\n2. Generating Observations:")
    print("-" * 70)

    current_time = int(time.time())

    # Morning rush (9am)
    morning_time = current_time - (current_time % 86400) + (9 * 3600)

    print(f"\nGenerating at 9am (high load time):")
    obs_morning = generator.generate_observation(
        "time_to_connect",
        timestamp=morning_time,
        include_classifiers=True
    )
    print(f"  time_to_connect: {obs_morning['value']}ms")
    print(f"  Classifiers:")
    for clf in obs_morning.get('classifiers', []):
        print(f"    {clf['name']}: {clf['value']:.3f} ({clf['status']})")

    # Overnight (3am)
    night_time = current_time - (current_time % 86400) + (3 * 3600)

    print(f"\nGenerating at 3am (low load time):")
    obs_night = generator.generate_observation(
        "time_to_connect",
        timestamp=night_time,
        include_classifiers=True
    )
    print(f"  time_to_connect: {obs_night['value']}ms")
    print(f"  Classifiers:")
    for clf in obs_night.get('classifiers', []):
        print(f"    {clf['name']}: {clf['value']:.3f} ({clf['status']})")

    # Verify alignment
    print("\n3. Verifying Causal Alignment:")
    print("-" * 70)

    # Calculate expected metric from classifiers
    weights = {"association": 0.20, "authorization": 0.25, "dhcp": 0.40, "dns": 0.15}

    clf_dict_morning = {c['name']: c['value'] for c in obs_morning.get('classifiers', [])}
    weighted_health_morning = sum(weights[name] * clf_dict_morning[name] for name in weights)

    # For lower_is_better metric:
    expected_morning = 15 + (1.0 - weighted_health_morning) * (200 - 15)

    print(f"\n9am Check:")
    print(f"  Weighted classifier health: {weighted_health_morning:.3f}")
    print(f"  Expected metric value: {expected_morning:.1f}ms")
    print(f"  Actual metric value: {obs_morning['value']}ms")
    print(f"  Difference: {abs(expected_morning - obs_morning['value']):.1f}ms")

    clf_dict_night = {c['name']: c['value'] for c in obs_night.get('classifiers', [])}
    weighted_health_night = sum(weights[name] * clf_dict_night[name] for name in weights)
    expected_night = 15 + (1.0 - weighted_health_night) * (200 - 15)

    print(f"\n3am Check:")
    print(f"  Weighted classifier health: {weighted_health_night:.3f}")
    print(f"  Expected metric value: {expected_night:.1f}ms")
    print(f"  Actual metric value: {obs_night['value']}ms")
    print(f"  Difference: {abs(expected_night - obs_night['value']):.1f}ms")

    # Success criteria
    print("\n4. Results:")
    print("-" * 70)

    morning_match = abs(expected_morning - obs_morning['value']) < 0.5
    night_match = abs(expected_night - obs_night['value']) < 0.5

    if morning_match and night_match:
        print("\n✅ SUCCESS: Causal architecture working correctly!")
        print("   Metrics are derived purely from classifier state.")
        print("   Time-of-day patterns emerge from load-sensitive classifiers.")
        return True
    else:
        print("\n❌ FAILURE: Metric values don't match classifier-derived expectations")
        return False

if __name__ == "__main__":
    success = test_causal_architecture()
    exit(0 if success else 1)
