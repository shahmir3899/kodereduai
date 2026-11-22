"""Scoring: weighted average, rescaling for measures that do not apply, bands, ranking."""
import pytest

from hr.models import default_performance_bands, default_performance_weights
from hr.performance.scoring import band_for, rank, score_teacher, validate_bands, validate_weights


def row(due, credit):
    return {'due': due, 'done': credit, 'on_time': credit, 'credit': credit, 'missed': []}


def test_weights_default_total_100():
    assert sum(default_performance_weights().values()) == 100
    assert validate_weights(default_performance_weights()) is None


def test_measures_that_do_not_apply_are_dropped_and_the_rest_rescaled():
    weights = default_performance_weights()
    # Only own attendance (10) and login days (5) apply: 100 and 40.
    overall, measures = score_teacher(
        {'own_attendance': row(10, 10), 'login_days': row(10, 4), 'attendance_marking': row(0, 0)}, weights,
    )
    assert measures['attendance_marking']['applicable'] is False
    assert measures['own_attendance']['effective_weight'] == pytest.approx(66.7, abs=0.1)
    assert measures['login_days']['effective_weight'] == pytest.approx(33.3, abs=0.1)
    assert overall == pytest.approx(100 * 10 / 15 + 40 * 5 / 15, abs=0.1)


def test_a_measure_weighted_zero_does_not_count():
    weights = {**default_performance_weights(), 'login_days': 0, 'own_attendance': 15}
    overall, measures = score_teacher({'own_attendance': row(1, 1), 'login_days': row(1, 0)}, weights)
    assert measures['login_days']['applicable'] is False
    assert overall == 100


def test_nothing_applicable_means_no_score():
    overall, _ = score_teacher({}, default_performance_weights())
    assert overall is None


def test_bands():
    bands = default_performance_bands()
    assert band_for(90, bands)['key'] == 'EXCELLENT'
    assert band_for(89.9, bands)['key'] == 'GOOD'
    assert band_for(60, bands)['key'] == 'FAIR'
    assert band_for(12, bands)['key'] == 'NEEDS_ATTENTION'
    assert band_for(None, bands) is None


def test_competition_ranking_with_ties_and_unscored():
    results = [{'overall_score': s} for s in (80, 95, 80, None, 60)]
    assert rank(results) == 4
    assert [r['rank'] for r in results] == [2, 1, 2, None, 4]


@pytest.mark.parametrize('weights, ok', [
    ({**default_performance_weights(), 'login_days': 6}, False),     # 101
    ({**default_performance_weights(), 'nonsense': 0}, False),
    ({**default_performance_weights(), 'login_days': -5, 'grading': 20}, False),
])
def test_invalid_weights(weights, ok):
    assert (validate_weights(weights) is None) is ok


def test_bands_need_a_floor_at_zero():
    assert validate_bands([{'key': 'A', 'label': 'A', 'min': 50}]) is not None
