"""Tool packs. Each module registers its tools when imported."""


def load_all():
    from . import (  # noqa: F401
        academics, attendance_tools, communication, directory, finance, finance_entries, finance_writes, lms_reads, lms_writes, study,
    )
