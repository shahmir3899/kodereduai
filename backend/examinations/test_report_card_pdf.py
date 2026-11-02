"""The report card PDF renderer: pure functions plus a real render (no database needed)."""
import re

from examinations.report_card_pdf import (
    exam_cell, exam_total, format_date, grade_key_text, ordinal, position_text, render_report_card_pdf, short_exam_name,
)

SUBJECTS = [
    {'subject_id': i, 'subject_name': name, 'total_marks': 100, 'marks_obtained': got, 'percentage': got,
     'grade': 'A' if got >= 80 else 'F', 'is_pass': got >= 40, 'is_absent': False, 'class_avg': 60, 'comment': ''}
    for i, (name, got) in enumerate([('English', 88), ('Maths', 35), ('Science', 72)], start=1)
]
REPORT = {
    'school_name': 'Sunrise Public School', 'student_name': 'Ayesha Khan', 'roll_number': '12', 'class_name': 'Class 5 - A',
    'academic_year_name': '2026-27', 'exam_display': '1st Term Exam', 'subjects': SUBJECTS, 'exams': [],
    'weighted': False, 'class_avg_unit': 'marks', 'earlier_exam_names': [], 'class_size': 30, 'issue_date': '2026-10-30',
    'summary': {'total_marks': 300, 'obtained_marks': 195, 'percentage': 65.0, 'grade': 'B', 'rank': 4, 'overall_pass': False},
    'grade_scales': [{'grade_label': 'A', 'min_percentage': 80, 'max_percentage': 100}],
}


def pages(pdf):
    return len(re.findall(rb'/Type\s*/Page[^s]', pdf))


def test_ordinals_and_positions():
    assert [ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 102)] == ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '102nd']
    assert position_text(4, 30) == '4th of 30'
    assert position_text(4, None) == '4th'


def test_exam_name_and_dates():
    assert short_exam_name('1st Term Exam 2026-27 - Playgroup') == '1st Term Exam'
    assert format_date('2026-10-30') == '30 Oct 2026'
    assert format_date('not a date') == 'not a date'


def test_grade_key_is_highest_band_first_and_skips_incomplete_rows():
    text = grade_key_text([
        {'grade_label': 'B', 'min_percentage': 60, 'max_percentage': 79.99},
        {'grade_label': 'A', 'min_percentage': 80, 'max_percentage': 100},
        {'grade_label': 'X', 'min_percentage': None, 'max_percentage': 5},
    ])
    assert text.index('A 80') < text.index('B 60')
    assert 'X' not in text
    assert grade_key_text([]) == ''


def test_exam_cells_accept_int_or_string_subject_keys():
    exam = {'marks': {'1': {'marks_obtained': 20, 'total_marks': 25}, 2: {'is_absent': True, 'total_marks': 25}}}
    assert exam_cell(exam, 1) == '20/25'
    assert exam_cell(exam, 2) == 'Abs'
    assert exam_cell(exam, 9) == '-'
    assert exam_total(exam, [1, 2, 9]) == '20/50'


def test_both_templates_make_a_valid_one_page_pdf_for_a_typical_card():
    for template in ('enhanced', 'traditional'):
        pdf = render_report_card_pdf(REPORT, None, template)
        assert pdf.startswith(b'%PDF')
        assert pages(pdf) == 1


def test_unknown_template_falls_back_to_enhanced_and_draft_is_marked():
    plain = render_report_card_pdf(REPORT, None, 'nonsense')
    draft = render_report_card_pdf({**REPORT, 'is_draft': True}, None, 'enhanced')
    assert plain.startswith(b'%PDF') and draft.startswith(b'%PDF')
    assert len(draft) != len(plain)


def test_multi_exam_weighted_card_renders():
    exams = [
        {'exam_id': 1, 'exam_name': 'Quiz 1 2026-27 - Class 5', 'is_main': False, 'weight': 20,
         'marks': {s['subject_id']: {'marks_obtained': 20, 'total_marks': 25} for s in SUBJECTS}},
        {'exam_id': 2, 'exam_name': '1st Term Exam 2026-27 - Class 5', 'is_main': True, 'weight': 80,
         'marks': {s['subject_id']: {'marks_obtained': s['marks_obtained'], 'total_marks': 100} for s in SUBJECTS}},
    ]
    pdf = render_report_card_pdf({**REPORT, 'exams': exams, 'weighted': True, 'earlier_exam_names': ['Quiz 1']}, None, 'traditional')
    assert pdf.startswith(b'%PDF')


def test_text_outside_windows_1252_is_dropped_not_fatal():
    pdf = render_report_card_pdf({**REPORT, 'student_name': 'Ayesha عائشہ <b>&'}, None, 'enhanced')
    assert pdf.startswith(b'%PDF')


def test_empty_card_still_renders():
    pdf = render_report_card_pdf({'student_name': 'New Student'}, None, 'traditional')
    assert pdf.startswith(b'%PDF')
