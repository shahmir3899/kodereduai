"""
Report card PDF, made on the server so the phone and the web get the same file.

The input is the dict ReportCardView returns, so the PDF can never show a number the screen
does not. Two layouts share one content model (as the web's templates share buildReportData):
'enhanced' (indigo, tiles, striped table) and 'traditional' (double-ruled navy frame, gold
labels, grid table). Text is Helvetica like the other generators, so characters outside Windows-1252
(for example Urdu names) are not drawn.
"""

import io
import re
from datetime import date
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import Circle, Drawing, Rect
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)


TEMPLATES = ('enhanced', 'traditional')
DEFAULT_TEMPLATE = 'enhanced'

DEFAULT_SIGNATURE_LABELS = {'class_teacher': 'Class Teacher', 'principal': 'Principal', 'parent': 'Parent'}
MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]

PAGE_W, PAGE_H = A4
MARGIN = 14 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

GOOD = colors.Color(31 / 255, 138 / 255, 95 / 255)
BAD = colors.Color(190 / 255, 60 / 255, 55 / 255)
AMBER = colors.Color(230 / 255, 160 / 255, 30 / 255)
MUTED = colors.Color(0.45, 0.47, 0.52)
HAIRLINE = colors.Color(205 / 255, 214 / 255, 222 / 255)


class Palette:
    def __init__(self, template):
        if template == 'traditional':
            self.ink = colors.Color(23 / 255, 50 / 255, 79 / 255)       # frame / header navy
            self.accent = colors.Color(138 / 255, 109 / 255, 31 / 255)  # gold section labels
            self.soft = colors.Color(244 / 255, 236 / 255, 214 / 255)
        else:
            self.ink = colors.Color(79 / 255, 70 / 255, 229 / 255)
            self.accent = colors.Color(110 / 255, 100 / 255, 220 / 255)
            self.soft = colors.Color(246 / 255, 246 / 255, 251 / 255)


# ── small pure helpers (also used by the tests) ─────────────────────────────────────────────

def ordinal(n):
    try:
        v = int(n)
    except (TypeError, ValueError):
        return str(n)
    if 11 <= v % 100 <= 13:
        return f'{v}th'
    return f"{v}{({1: 'st', 2: 'nd', 3: 'rd'}.get(v % 10, 'th'))}"


def position_text(rank, class_size):
    return f'{ordinal(rank)} of {class_size}' if class_size else ordinal(rank)


def short_exam_name(name):
    """'1st Term Exam 2026-27 - Playgroup' -> '1st Term Exam' (headers are narrow)."""
    text = str(name or '')
    short = re.sub(r'\s+[-–]\s+.*$', '', text)
    short = re.sub(r'\s*\d{4}\s*[-/]\s*\d{2,4}\s*$', '', short).strip()
    return short or text


def format_date(iso):
    try:
        d = date.fromisoformat(str(iso)[:10])
    except ValueError:
        return str(iso or '')
    return f'{d.day} {d.strftime("%b %Y")}'


def grade_key_text(grade_scales):
    """'Grade key: A+ 90-100% · A 80-89% ...' highest band first, from the school's own scale."""
    scales = [g for g in (grade_scales or [])
              if g.get('grade_label') and g.get('min_percentage') is not None and g.get('max_percentage') is not None]
    if not scales:
        return ''

    def num(v):
        return f'{round(float(v), 2):g}'

    parts = [f"{g['grade_label']} {num(g['min_percentage'])}–{num(g['max_percentage'])}%"
             for g in sorted(scales, key=lambda g: -float(g['min_percentage']))]
    return 'Grade key:  ' + '   ·   '.join(parts)


def pct_text(v):
    return f'{float(v):.1f}%' if v is not None else '-'


def exam_cell(exam, subject_id):
    marks = exam.get('marks') or {}
    m = marks.get(subject_id) or marks.get(str(subject_id))
    if not m:
        return '-'
    if m.get('is_absent'):
        return 'Abs'
    got = m.get('marks_obtained')
    return f"{'-' if got is None else _num(got)}/{_num(m.get('total_marks'))}"


def exam_total(exam, subject_ids):
    got = of = 0.0
    marks = exam.get('marks') or {}
    for sid in subject_ids:
        m = marks.get(sid) or marks.get(str(sid))
        if not m:
            continue
        of += float(m.get('total_marks') or 0)
        if not m.get('is_absent') and m.get('marks_obtained') is not None:
            got += float(m['marks_obtained'])
    return f'{_num(got)}/{_num(of)}' if of else '-'


def _num(v):
    if v is None:
        return '-'
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return f'{f:g}'


def _plain(text):
    """For plain table cells, which are drawn as written (no markup): same Latin-1 filter, no escaping."""
    return str(text if text is not None else '').encode('cp1252', 'ignore').decode('cp1252')


def _t(text):
    """Paragraph-safe text; characters Helvetica cannot draw are dropped, not shown as boxes."""
    return escape(str(text or '').encode('cp1252', 'ignore').decode('cp1252'))


# ── drawing pieces ──────────────────────────────────────────────────────────────────────────

def _dots(rating, color, size=2.2 * mm):
    """Five dots, the first `rating` filled; used for the 1 to 5 skill and behaviour ratings."""
    gap = 0.8 * mm
    d = Drawing(5 * size + 4 * gap, size)
    n = int(rating or 0)
    for i in range(5):
        c = Circle(size / 2 + i * (size + gap), size / 2, size / 2)
        c.fillColor = color if i < n else colors.Color(0.8, 0.82, 0.85)
        c.strokeColor = None
        d.add(c)
    return d


def _attendance_bar(att, width):
    d = Drawing(width, 3 * mm)
    track = Rect(0, 0, width, 3 * mm, rx=1.5 * mm, ry=1.5 * mm)
    track.fillColor = colors.Color(0.87, 0.88, 0.91)
    track.strokeColor = None
    d.add(track)
    days = att.get('working_days') or 0
    x = 0.0
    for n, color in ((att.get('present'), GOOD), (att.get('absent'), BAD), (att.get('leave'), AMBER)):
        w = (float(n or 0) / days) * width if days else 0
        if w > 0:
            seg = Rect(x, 0, w, 3 * mm)
            seg.fillColor = color
            seg.strokeColor = None
            d.add(seg)
            x += w
    return d


def _styles(p):
    def style(name, **kw):
        base = dict(fontName='Helvetica', fontSize=9, leading=11.5, textColor=colors.Color(0.12, 0.12, 0.14))
        base.update(kw)
        return ParagraphStyle(name, **base)

    return {
        'body': style('body'),
        'small': style('small', fontSize=8, leading=10, textColor=MUTED),
        'label': style('label', fontName='Helvetica-Bold', fontSize=7.5, leading=9, textColor=p.accent),
        'bold': style('bold', fontName='Helvetica-Bold'),
        'italic': style('italic', fontName='Helvetica-Oblique', fontSize=9.5, leading=12.5, textColor=colors.Color(0.2, 0.2, 0.24)),
        'comment': style('comment', fontName='Helvetica-Oblique', fontSize=8, leading=10, textColor=colors.Color(0.37, 0.39, 0.45)),
        'center': style('center', alignment=TA_CENTER),
        'school': style('school', fontName='Helvetica-Bold', fontSize=16, leading=19, textColor=p.ink),
        'school_c': style('school_c', fontName='Helvetica-Bold', fontSize=16, leading=19, textColor=p.ink, alignment=TA_CENTER),
        'sub_c': style('sub_c', fontSize=8.5, leading=11, textColor=MUTED, alignment=TA_CENTER),
        'title': style('title', fontName='Helvetica-Bold', fontSize=12.5, leading=15, textColor=p.ink),
        'right': style('right', alignment=TA_RIGHT, textColor=MUTED, fontSize=9.5),
        'tile_label': style('tile_label', fontSize=7.5, leading=9, textColor=MUTED),
        'tile_value': style('tile_value', fontName='Helvetica-Bold', fontSize=13, leading=16, textColor=p.ink),
        'sign': style('sign', fontSize=7.5, leading=9, textColor=MUTED, alignment=TA_CENTER),
    }


# ── the document ────────────────────────────────────────────────────────────────────────────

def render_report_card_pdf(report, school=None, template=DEFAULT_TEMPLATE, today=None):
    """PDF bytes for one report (the ReportCardView payload). `school` supplies the address and logo."""
    template = template if template in TEMPLATES else DEFAULT_TEMPLATE
    trad = template == 'traditional'
    p = Palette(template)
    st = _styles(p)
    story = []

    subjects = report.get('subjects') or []
    exams = report.get('exams') or []
    summary = report.get('summary') or None
    att = report.get('attendance') or None
    conduct = report.get('conduct_assessment') or None
    weighted = bool(report.get('weighted'))
    class_size = report.get('class_size')
    issue = report.get('issue_date') or (today or date.today()).isoformat()
    sig = {**DEFAULT_SIGNATURE_LABELS, **(report.get('signature_labels') or {})}
    school_name = report.get('school_name') or getattr(school, 'name', '') or 'Report Card'
    address = getattr(school, 'address', '') or ''
    class_name = report.get('class_name') or '-'
    roll = report.get('roll_number') or '-'
    exam_display = report.get('exam_display') or report.get('term_name') or ''
    student = report.get('student_name') or '-'

    if report.get('is_draft'):
        story.append(Paragraph('<b>DRAFT</b> – results have not been announced yet.',
                               ParagraphStyle('draft', parent=st['small'], textColor=BAD, alignment=TA_CENTER)))
        story.append(Spacer(1, 2 * mm))

    # Header
    logo = None
    if school is not None:
        # Imported here so the renderer itself needs no Django; a logo that cannot be fetched is just omitted.
        from core.pdf_branding import reportlab_logo
        logo = reportlab_logo(school, 16 if trad else 14)
    if trad:
        if logo:
            logo.hAlign = 'CENTER'
            story.append(logo)
            story.append(Spacer(1, 2 * mm))
        story.append(Paragraph(_t(school_name), st['school_c']))
        if address:
            story.append(Paragraph(_t(address), st['sub_c']))
        story.append(Spacer(1, 2 * mm))
        story.append(_rule(p.ink, 0.8))
        story.append(Spacer(1, 2 * mm))
        label = f'PROGRESS REPORT · {exam_display}'.upper() if exam_display else 'PROGRESS REPORT'
        story.append(Paragraph(_t(label), ParagraphStyle('t', parent=st['label'], fontSize=10.5, leading=13, alignment=TA_CENTER)))
        story.append(Spacer(1, 4 * mm))

        guardian = report.get('guardian_name') or '-'
        info = [
            ['Student', _t(student), 'Class / Section', _t(class_name)],
            ['Roll No.', _t(roll), 'Guardian', _t(guardian)],
            ['Academic Year', _t(report.get('academic_year_name') or ''), 'Term', _t(report.get('term_name') or '-')],
            ['Date of Issue', Paragraph(f'<b>{_t(format_date(issue))}</b>', st['body']), '', ''],
        ]
        info = [[c if not isinstance(c, str) else Paragraph(c, st['bold'] if i % 2 == 0 else st['body'])
                 for i, c in enumerate(row)] for row in info]
        t = Table(info, colWidths=[CONTENT_W * 0.2, CONTENT_W * 0.3, CONTENT_W * 0.2, CONTENT_W * 0.3])
        t.setStyle(TableStyle([
            ('GRID', (0, 0), (-1, -1), 0.3, HAIRLINE), ('SPAN', (1, 3), (3, 3)),
            ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        story += [t, Spacer(1, 5 * mm)]
    else:
        right = [Paragraph(_t(school_name), st['school']),
                 Paragraph(_t(f"{class_name}  ·  Roll No. {roll}"), ParagraphStyle('m', parent=st['small'], fontSize=9.5, leading=12))]
        head = Table([[logo, right]] if logo else [[right]],
                     colWidths=[logo.drawWidth + 6 * mm, None] if logo else [CONTENT_W])
        head.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('LEFTPADDING', (0, 0), (-1, -1), 0)]))
        story += [head, Spacer(1, 2 * mm), _rule(p.ink, 0.6), Spacer(1, 3 * mm)]

        term_line = ' · '.join(x for x in (report.get('academic_year_name'), exam_display) if x)
        title = Table([[Paragraph(_t(f'Report Card – {student}'), st['title']),
                        [Paragraph(_t(term_line), st['right']),
                         Paragraph(f"Date of Issue: <font color='#{p.ink.hexval()[2:]}'><b>{_t(format_date(issue))}</b></font>", st['right'])]]],
                      colWidths=[CONTENT_W * 0.5, CONTENT_W * 0.5])
        title.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0)]))
        story.append(title)
        if report.get('guardian_name'):
            story.append(Paragraph(_t(f"Guardian: {report['guardian_name']}"), st['small']))
        story.append(Spacer(1, 2 * mm))

    # Which exam decided the result
    earlier = report.get('earlier_exam_names') or []
    if earlier:
        main_name = next((e.get('exam_name') for e in exams if e.get('is_main')), '')
        note = (f"Weighted result across: {', '.join([*earlier, main_name] if main_name else earlier)}" if weighted
                else f"Result is from {main_name}. Earlier exams shown for reference: {', '.join(earlier)}")
        story += [Paragraph(_t(note), st['small']), Spacer(1, 2 * mm)]

    # Position / grade tiles (enhanced) or attendance and position boxes (traditional)
    rank = (summary or {}).get('rank')
    if trad:
        boxes = []
        if att and (att.get('working_days') or 0) > 0:
            pct = f" ({att['percentage']}%)" if att.get('percentage') is not None else ''
            boxes.append(('ATTENDANCE', f"{att.get('present', 0)} / {att['working_days']} days{pct}"))
        if rank:
            boxes.append(('POSITION', position_text(rank, class_size)))
        if boxes:
            story += [_tiles(boxes, p, st, boxed=True), Spacer(1, 5 * mm)]
    else:
        tiles = []
        if rank:
            tiles.append(('POSITION', position_text(rank, class_size)))
        if (summary or {}).get('grade'):
            tiles.append(('OVERALL', str(summary['grade'])))
        if tiles:
            story += [_tiles(tiles, p, st, boxed=False), Spacer(1, 3 * mm)]
        if att and (att.get('working_days') or 0) > 0:
            story += [_attendance_panel(att, p, st), Spacer(1, 3 * mm)]

    # Marks
    if subjects:
        story.append(_marks_table(report, subjects, exams, summary, weighted, p, st, trad))
        key = grade_key_text(report.get('grade_scales'))
        if key:
            story += [Spacer(1, 2 * mm), Paragraph(_t(key), ParagraphStyle('key', parent=st['small'], fontSize=7.5))]
        story.append(Spacer(1, 3 * mm))

    # Promotion (final exam only; NOT_APPLICABLE prints nothing)
    if report.get('promotion_applicable') and report.get('promotion_status') not in (None, 'NOT_APPLICABLE'):
        promoted = report.get('promotion_status') == 'PROMOTED'
        color = GOOD if promoted else BAD
        promo = Table([[Paragraph('<b>PROMOTION STATUS</b>', st['label']),
                        Paragraph(f"<font color='#{color.hexval()[2:]}'><b>{'PROMOTED' if promoted else 'NOT PROMOTED'}</b></font>",
                                  ParagraphStyle('pr', parent=st['body'], alignment=TA_RIGHT, fontSize=11))]],
                      colWidths=[CONTENT_W * 0.5, CONTENT_W * 0.5])
        promo.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 0.8, color), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
        story += [promo, Spacer(1, 3 * mm)]

    # Skills and behaviour
    skills = (conduct or {}).get('skills') or []
    behaviour = (conduct or {}).get('behaviour') or []
    if skills or behaviour:
        month = conduct.get('month')
        heading = 'SKILLS & BEHAVIOUR ASSESSMENT' + (f' — {MONTH_NAMES[month - 1].upper()}' if month else '')
        rows = []
        for i in range(max(len(skills), len(behaviour))):
            row = []
            for items in (skills, behaviour):
                if i < len(items):
                    row += [Paragraph(_t(items[i].get('label')), ParagraphStyle('sb', parent=st['body'], fontSize=8, leading=10)),
                            _dots(items[i].get('rating'), p.ink)]
                else:
                    row += ['', '']
            rows.append(row)
        sb = Table(rows, colWidths=[CONTENT_W * 0.28, CONTENT_W * 0.22, CONTENT_W * 0.28, CONTENT_W * 0.22])
        sb.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'MIDDLE'), ('TOPPADDING', (0, 0), (-1, -1), 1), ('BOTTOMPADDING', (0, 0), (-1, -1), 1)]))
        story.append(KeepTogether([Paragraph(_t(heading), st['label']), Spacer(1, 1.5 * mm), sb, Spacer(1, 3 * mm)]))

    # Comments and remarks
    overall = report.get('overall_comment') or ''
    teacher_remark = (conduct or {}).get('teacher_remark') or ''
    principal_remark = (conduct or {}).get('principal_remark') or ''
    notes = []
    if overall:
        notes.append(_note_box('OVERALL PERFORMANCE', overall, p, st, trad))
    if teacher_remark or trad:
        notes.append(_note_box("CLASS TEACHER'S REMARKS", teacher_remark, p, st, trad))
    if principal_remark:
        notes.append(_note_box("PRINCIPAL'S REMARKS", principal_remark, p, st, trad))
    last_note = notes.pop() if notes else None
    for box in notes:
        story += [KeepTogether([box]), Spacer(1, 2 * mm)]

    # Signatures
    labels = [sig['class_teacher'], sig['principal'], 'Parent / Guardian' if trad else sig['parent']]
    gap = 8 * mm
    col = (CONTENT_W - 2 * gap) / 3
    cells = [Paragraph(_t(label.upper()), st['sign']) for label in labels]
    sign = Table([['', '', '', '', ''], [cells[0], '', cells[1], '', cells[2]]], colWidths=[col, gap, col, gap, col], rowHeights=[1, None])
    sign.setStyle(TableStyle([('LINEABOVE', (c, 1), (c, 1), 0.5, p.ink) for c in (0, 2, 4)] + [('TOPPADDING', (0, 1), (-1, 1), 3)]))
    # The gap is inside the keep-together block so the line never lands alone on a page of its own.
    story.append(KeepTogether([*([last_note] if last_note else []), Spacer(1, 7 * mm), sign]))

    buf = io.BytesIO()

    def frame(canvas, doc):
        if not trad:
            return
        canvas.saveState()
        canvas.setStrokeColor(p.ink)
        canvas.setLineWidth(1)
        canvas.rect(MARGIN - 6, 8 * mm, CONTENT_W + 12, PAGE_H - 16 * mm)
        canvas.setLineWidth(0.4)
        canvas.rect(MARGIN - 4, 8 * mm + 2, CONTENT_W + 8, PAGE_H - 16 * mm - 4)
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=14 * mm if not trad else 16 * mm, bottomMargin=14 * mm,
        title=f'Report Card - {student}', author=school_name,
    )
    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return buf.getvalue()


def _rule(color, width):
    t = Table([['']], colWidths=[CONTENT_W], rowHeights=[1])
    t.setStyle(TableStyle([('LINEBELOW', (0, 0), (-1, 0), width, color), ('LEFTPADDING', (0, 0), (-1, -1), 0)]))
    return t


def _tiles(items, p, st, boxed):
    w = CONTENT_W / len(items)
    cells = [[Paragraph(label, st['tile_label']), Paragraph(_t(value), st['tile_value'])] for label, value in items]
    t = Table([cells], colWidths=[w] * len(items))
    style = [('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]
    style += [('BOX', (0, 0), (-1, -1), 0.4, p.ink), ('INNERGRID', (0, 0), (-1, -1), 0.4, p.ink)] if boxed else [
        ('BACKGROUND', (i, 0), (i, 0), p.soft) for i in range(len(items))] + [('LINEAFTER', (0, 0), (-2, 0), 4, colors.white)]
    t.setStyle(TableStyle(style))
    return t


def _attendance_panel(att, p, st):
    days = att['working_days']
    pct = f"  ({att['percentage']}%)" if att.get('percentage') is not None else ''
    period = f"{format_date(att['from'])} – {format_date(att['to'])}" if att.get('from') and att.get('to') else ''
    legend = [('Present', att.get('present', 0)), ('Absent', att.get('absent', 0)), ('Leave', att.get('leave', 0))]
    if (att.get('not_marked') or 0) > 0:
        legend.append(('Not marked', att['not_marked']))
    rows = [
        [Paragraph('ATTENDANCE', st['tile_label']), Paragraph(_t(period), ParagraphStyle('ap', parent=st['tile_label'], alignment=TA_RIGHT))],
        [Paragraph(f"<font color='#{GOOD.hexval()[2:]}'><b>{att.get('present', 0)} / {days} days{pct}</b></font>", ParagraphStyle('av', parent=st['body'], fontSize=12, leading=15)), ''],
        [_attendance_bar(att, CONTENT_W - 10 * mm), ''],
        [Paragraph('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'.join(f'{label}: {n}' for label, n in legend), ParagraphStyle('lg', parent=st['small'], fontSize=7.8)), ''],
    ]
    if att.get('suspect'):
        rows.append([Paragraph(f"Attendance was not recorded on {att.get('not_marked', 0)} of {days} working days.",
                               ParagraphStyle('sus', parent=st['small'], textColor=colors.Color(0.71, 0.43, 0.08))), ''])
    t = Table(rows, colWidths=[CONTENT_W * 0.5, CONTENT_W * 0.5])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), p.soft), ('SPAN', (0, 1), (1, 1)), ('SPAN', (0, 2), (1, 2)), ('SPAN', (0, 3), (1, 3)),
        *([('SPAN', (0, 4), (1, 4))] if att.get('suspect') else []),
        ('LEFTPADDING', (0, 0), (-1, -1), 5 * mm), ('RIGHTPADDING', (0, 0), (-1, -1), 5 * mm),
        ('TOPPADDING', (0, 0), (-1, -1), 2), ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    return t


def _marks_table(report, subjects, exams, summary, weighted, p, st, trad):
    multi = len(exams) > 1
    unit = '%' if report.get('class_avg_unit') == 'percent' else ''

    def avg(v):
        return '-' if v is None else f'{_num(v)}{unit}'

    cs = ParagraphStyle('cs', parent=st['comment'])
    head_style = ParagraphStyle('hd', parent=st['body'], fontName='Helvetica-Bold', textColor=colors.white, alignment=TA_CENTER)
    subject_ids = [s.get('subject_id') for s in subjects]

    if not multi:
        head = ['Subject', 'Max Marks' if trad else 'Total', 'Obtained', '%', 'Grade'] + ([] if trad else ['Class Avg', 'Status'])
        widths = [0.34, 0.16, 0.16, 0.17, 0.17] if trad else [0.24, 0.12, 0.14, 0.12, 0.12, 0.14, 0.12]

        def row(s):
            r = [s.get('subject_name'), _num(s.get('total_marks')),
                 'Absent' if s.get('is_absent') else _num(s.get('marks_obtained')),
                 _num_or_dash(s.get('percentage'), 1), s.get('grade') or '-']
            if not trad:
                r += [avg(s.get('class_avg')), 'Pass' if s.get('is_pass') is True else 'Fail' if s.get('is_pass') is False else '-']
            return r

        foot = None
        if summary:
            foot = ['Total', _num(summary.get('total_marks')), _num(summary.get('obtained_marks')),
                    _num_or_dash(summary.get('percentage'), 1), summary.get('grade') or '-']
            if not trad:
                foot += ['', 'Pass' if summary.get('overall_pass') is True else 'Fail' if summary.get('overall_pass') is False else '-']
        fail_col = None
    else:
        k = len(exams)
        head = ['Subject'] + [short_exam_name(e.get('exam_name')) + (f"\n{e.get('weight')}%" if weighted else '') for e in exams] + \
               ['Result %' if weighted else '%', 'Grade', 'Class Avg']
        exam_w = (1 - 0.24 - 0.31) / k
        widths = [0.24] + [exam_w] * k + [0.10, 0.09, 0.12]

        def row(s):
            return [s.get('subject_name')] + [exam_cell(e, s.get('subject_id')) for e in exams] + \
                   [_num_or_dash(s.get('percentage'), 1), s.get('grade') or '-', avg(s.get('class_avg'))]

        foot = None
        if summary:
            foot = ['Total'] + [exam_total(e, subject_ids) for e in exams] + \
                   [_num_or_dash(summary.get('percentage'), 1), summary.get('grade') or '-', '']
        fail_col = k + 1

    ncols = len(head)
    data = [[Paragraph(_t(h).replace('\n', '<br/>'), head_style) for h in head]]
    styles = [
        ('BACKGROUND', (0, 0), (-1, 0), p.ink), ('ALIGN', (1, 0), (-1, -1), 'CENTER'), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'), ('FONTSIZE', (0, 1), (-1, -1), 8.5 if multi else 9),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    styles += [('GRID', (0, 0), (-1, -1), 0.3, HAIRLINE)] if trad else []
    for i, s in enumerate(subjects):
        r = len(data)
        data.append([_plain(c) for c in row(s)])
        styles.append(('FONTNAME', (0, r), (0, r), 'Helvetica-Bold' if trad else 'Helvetica'))
        if not trad and i % 2:
            styles.append(('BACKGROUND', (0, r), (-1, r + (1 if s.get('comment') else 0)), colors.Color(245 / 255, 245 / 255, 250 / 255)))
        if multi:
            for j, e in enumerate(exams):
                styles.append(('FONTNAME', (1 + j, r), (1 + j, r), 'Helvetica-Bold' if e.get('is_main') else 'Helvetica'))
                if not e.get('is_main'):
                    styles.append(('TEXTCOLOR', (1 + j, r), (1 + j, r), MUTED))
        if fail_col is not None and s.get('is_pass') is False:
            styles.append(('TEXTCOLOR', (fail_col, r), (fail_col, r), BAD))
        if s.get('comment'):
            c = len(data)
            data.append([Paragraph(_t(s['comment']), cs)] + [''] * (ncols - 1))
            styles += [('SPAN', (0, c), (-1, c)), ('ALIGN', (0, c), (-1, c), 'LEFT'), ('TOPPADDING', (0, c), (-1, c), 1), ('BOTTOMPADDING', (0, c), (-1, c), 4)]
    if foot:
        r = len(data)
        data.append([_plain(c) for c in foot])
        styles += [('FONTNAME', (0, r), (-1, r), 'Helvetica-Bold'), ('BACKGROUND', (0, r), (-1, r), p.soft)]

    t = Table(data, colWidths=[CONTENT_W * w for w in widths], repeatRows=1)
    t.setStyle(TableStyle(styles))
    return t


def _num_or_dash(v, digits):
    return '-' if v is None else f'{float(v):.{digits}f}'


def _note_box(label, text, p, st, trad):
    body = Paragraph(_t(text) if text else '&nbsp;', st['italic'] if not trad else st['body'])
    t = Table([[Paragraph(_t(label), st['label'])], [body]], colWidths=[CONTENT_W])
    if trad:
        t.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 0.4, p.ink), ('LEFTPADDING', (0, 0), (-1, -1), 5 * mm),
                               ('BOTTOMPADDING', (0, 1), (-1, 1), 6), ('TOPPADDING', (0, 0), (-1, 0), 4)]))
    else:
        t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), p.soft), ('LINEBEFORE', (0, 0), (0, -1), 1.5, p.ink),
                               ('LEFTPADDING', (0, 0), (-1, -1), 5 * mm), ('BOTTOMPADDING', (0, 1), (-1, 1), 6), ('TOPPADDING', (0, 0), (-1, 0), 4)]))
    return t
