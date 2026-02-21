"""
Background tasks for academics operations.
"""

import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, time_limit=120)
def auto_generate_timetable_task(self, school_id, class_id, algorithm='greedy'):
    """Auto-generate a timetable using the selected algorithm.

    Args:
        algorithm: 'greedy' for fast heuristic-based generation,
                   'or_tools' for constraint programming solver (up to 30s).
    """
    from core.task_utils import update_task_progress, mark_task_success, mark_task_failed

    task_id = self.request.id

    try:
        update_task_progress(task_id, current=10, total=100)

        if algorithm == 'or_tools':
            from academics.ai_engine import ORToolsTimetableGenerator
            generator = ORToolsTimetableGenerator(school_id, class_id)
        else:
            from academics.ai_engine import TimetableGenerator
            generator = TimetableGenerator(school_id, class_id)

        result = generator.generate()

        update_task_progress(task_id, current=90, total=100)

        if not result.success:
            mark_task_failed(task_id, result.error)
            return {'success': False, 'error': result.error}

        result_data = {
            'grid': result.grid,
            'score': result.score,
            'warnings': result.warnings,
            'algorithm': algorithm,
            'message': f'Timetable generated with score {result.score} using {algorithm}.',
        }
        mark_task_success(task_id, result_data=result_data)
        return result_data

    except Exception as e:
        logger.exception(f"Timetable auto-generation failed: {e}")
        mark_task_failed(task_id, str(e))
        raise
