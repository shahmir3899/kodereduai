"""
Threshold Service - Reads per-school AI thresholds with system defaults as fallback.

Used by the attendance pipeline to get configurable threshold values instead of hard-coded constants.
"""


class ThresholdService:
    """Reads AI thresholds for a school, falling back to system defaults."""

    DEFAULTS = {
        'fuzzy_name_match': 0.45,
        'rule_confidence': 0.7,
        'high_confidence': 0.8,
        'uncertain_threshold': 0.6,
        'student_match_score': 70,
        'row_tolerance': 15,
        'col_tolerance': 10,
    }

    def __init__(self, school):
        self.school = school
        ai_config = getattr(school, 'ai_config', None) or {}
        self._config = ai_config.get('thresholds', {})

    def get(self, key: str, default=None):
        """Get threshold value, falling back to system default."""
        value = self._config.get(key)
        if value is not None:
            return value
        if default is not None:
            return default
        return self.DEFAULTS.get(key)

    def get_all(self) -> dict:
        """Get all thresholds with defaults filled in."""
        result = dict(self.DEFAULTS)
        result.update({k: v for k, v in self._config.items() if v is not None})
        return result
