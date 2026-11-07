"""Layout/Urdu helpers of the student report PDF — pure rendering, no database."""
import io

from collections import OrderedDict

from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate

from reports.generators.student import (
    URDU_FONT, build_lessons_grid, group_lessons, has_urdu, urdu_aware_style,
)
from datetime import date

URDU = 'اردو کا سبق: پہلا باب'


def _styles():
    base = getSampleStyleSheet()['Normal']
    return (
        ParagraphStyle('S', parent=base, fontSize=9.5, leading=12),
        ParagraphStyle('I', parent=base, fontSize=8.5, leading=10.5),
    )


def _build(flowables):
    buf = io.BytesIO()
    SimpleDocTemplate(buf).build(flowables)
    return buf.getvalue()


def test_has_urdu_detects_arabic_script_only():
    assert has_urdu(URDU)
    assert not has_urdu('The Kind Fisherman 123')
    assert not has_urdu('')


def test_urdu_style_switches_font_only_for_urdu():
    _, item = _styles()
    assert urdu_aware_style(item, 'English').fontName == item.fontName
    assert urdu_aware_style(item, URDU).fontName == URDU_FONT


def test_lessons_grid_renders_with_urdu_font_embedded():
    subject, item = _styles()
    lessons = OrderedDict([
        ('English', {'total': 1, 'groups': [(None, ['The Kind Fisherman'])]}),
        ('Urdu', {'total': 30, 'groups': [('Week 1 (01 Nov - 07 Nov)', [URDU] * 30)]}),
    ])
    pdf = _build([build_lessons_grid(lessons, subject, item)])
    assert pdf.startswith(b'%PDF')
    assert b'NotoNastaliqUrdu' in pdf


def test_lessons_grid_two_subjects_share_a_row():
    subject, item = _styles()
    grid = build_lessons_grid(OrderedDict([('A', {'total': 1, 'groups': [(None, ['x'])]}), ('B', {'total': 1, 'groups': [(None, ['y'])]})]), subject, item)
    assert len(grid._cellvalues) == 1


def test_group_lessons_weeks_dedupe_and_single_bucket():
    plans = [(date(2026, 11, 2), 'Ants'), (date(2026, 11, 3), 'Ants'), (date(2026, 11, 9), 'Fish')]
    groups = group_lessons(plans, date(2026, 11, 1), date(2026, 11, 30))
    assert groups == [('Week 1 (01 Nov - 07 Nov)', ['Ants (x2)']), ('Week 2 (08 Nov - 14 Nov)', ['Fish'])]
    assert group_lessons(plans[:2], date(2026, 11, 1), date(2026, 11, 30)) == [(None, ['Ants (x2)'])]


def test_group_lessons_long_period_groups_by_month():
    plans = [(date(2026, 10, 5), 'A'), (date(2026, 11, 5), 'B')]
    labels = [g[0] for g in group_lessons(plans, date(2026, 8, 1), date(2027, 3, 31))]
    assert labels == ['October 2026', 'November 2026']
