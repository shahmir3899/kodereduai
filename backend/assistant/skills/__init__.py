"""Tool packs. Each module registers its tools when imported."""


def load_all():
    from . import (  # noqa: F401
        academics, attendance_tools, communication, coverage_reads, directory, exam_tools, finance, finance_entries, finance_gaps, finance_writes, gaps, hr_payroll, hr_tools,lms_reads, lms_submissions, lms_writes, messaging_tools, ops_hostel, ops_inventory, ops_library, ops_transport, parent_tools, preferences, student_fee_tools, student_tools, study, study_extras,
    )
