"""The pass/fail rule shared by the exam results screen, the report card and the
session-health dashboard, so the three can never disagree about who passed."""


def subject_is_pass(obtained, passing_marks):
    """Pass only with marks entered and at or above the passing marks. Absent
    and not-yet-entered both fail the subject."""
    return obtained is not None and obtained >= passing_marks


def calculate_overall_pass(subject_results, fail_threshold=3):
    """
    Determines overall exam pass/fail from subject-level results.

    A student fails overall once their failed-subject count reaches
    fail_threshold (an exam's own Exam.fail_threshold_subjects).
    """
    failed_subjects = sum(
        1 for subject in subject_results
        if not subject['is_pass']
    )

    return failed_subjects < fail_threshold
