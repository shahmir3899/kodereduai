"""Printable fee vouchers: one strip per student (School copy | Student copy), 3 strips per A4.

A voucher is a printed view of existing FeePayment rows, nothing is stored. Its total must
match what the family owes today (finance.student_balance), so it follows the same rules:

  * monthly rows are cumulative (amount_due = previous_balance + base fee), so per category
    only the latest row up to the voucher month counts; its previous_balance is the
    "previous unpaid" and older rows are never added again;
  * a category with no row this month but an unpaid older row adds that balance to
    "previous unpaid";
  * annual / one-off rows that still owe money are listed as their own lines;
  * a credit (paid above due) never lowers another row's balance;
  * rows handed over to another branch are owed there, not here.
"""
import calendar
import io
from datetime import date
from decimal import Decimal

from .models import Account, FeePayment, KuickpayBill, KuickpaySchoolMapping

ZERO = Decimal('0')
DEFAULT_DUE_DAY = 10
# Lines a voucher copy has room for; anything beyond is folded into one "Other charges" line
# so a student with many fees never spills over the next student's strip.
MAX_LINES = 6  # with both 'discount' and 'paid' rows the strip still fits (checked by eye)


def due_day_for(school):
    config = getattr(school, 'finance_config', None) or {}
    try:
        day = int(config.get('due_day') or DEFAULT_DUE_DAY)
    except (TypeError, ValueError):
        day = DEFAULT_DUE_DAY
    return min(max(day, 1), 28)


def voucher_bank_account(school):
    """The Bank account the school chose to print, or None (missing, inactive, not a bank)."""
    config = getattr(school, 'finance_config', None) or {}
    account_id = config.get('voucher_bank_account_id')
    if not account_id:
        return None
    return Account.objects.filter(
        id=account_id, school_id=school.id, is_active=True, account_type=Account.AccountType.BANK,
    ).first()


def _balance(row):
    return (row.amount_due or ZERO) - (row.amount_paid or ZERO)


def _category_name(row):
    category = row.monthly_category if row.fee_type == 'MONTHLY' else row.annual_category
    return getattr(category, 'name', None) or row.get_fee_type_display()


def compute_voucher(rows, year, month):
    """Lines and totals for one student from all their FeePayment rows.

    Returns {'lines': [{'label', 'amount'}], 'current_total', 'discount', 'previous_unpaid', 'paid',
    'total_payable', 'academic_year_id'};
    total_payable == current_total - discount + previous_unpaid - paid.

    Lines show each fee before its discount (FeePayment.discount_amount), and the discounts are one
    "Less: discount" figure, so a parent sees the full fee and what was taken off.
    """
    target = (year, month)
    latest_monthly = {}
    others = []
    for row in sorted(rows, key=lambda r: (r.year, r.month, r.id)):
        if row.handed_over_to_exit_id:
            continue
        if row.fee_type == 'MONTHLY':
            if (row.year, row.month) <= target:
                latest_monthly[row.monthly_category_id] = row
        else:
            others.append(row)

    lines, previous, paid, discount = [], ZERO, ZERO, ZERO
    academic_year_id = None
    for row in latest_monthly.values():
        if (row.year, row.month) == target:
            academic_year_id = academic_year_id or row.academic_year_id
            row_discount = row.discount_amount or ZERO
            discount += row_discount
            lines.append({'label': _category_name(row), 'amount': (row.base_monthly_fee or ZERO) + row_discount})
            previous += row.previous_balance or ZERO
            # Capped at what was due so an overpaid row shows as settled, not as a credit
            # that silently cuts the other fees' total.
            paid += min(row.amount_paid or ZERO, row.amount_due or ZERO)
        else:
            previous += max(_balance(row), ZERO)

    for row in others:
        balance = _balance(row)
        if balance > ZERO:
            label = f"{_category_name(row)} ({row.get_fee_type_display()} {row.year})"
            row_discount = row.discount_amount or ZERO
            discount += row_discount
            lines.append({'label': label, 'amount': balance + row_discount})

    if len(lines) > MAX_LINES:
        folded = sum((line['amount'] for line in lines[MAX_LINES - 1:]), ZERO)
        lines = lines[:MAX_LINES - 1] + [{'label': 'Other charges', 'amount': folded}]

    current = sum((line['amount'] for line in lines), ZERO)
    return {
        'lines': lines,
        'current_total': current,
        'discount': discount,
        'previous_unpaid': previous,
        'paid': paid,
        'total_payable': max(current - discount + previous - paid, ZERO),
        'academic_year_id': academic_year_id,
    }


def build_vouchers(school, student_ids, year, month, only_unpaid=True, due_date=None):
    """Voucher dicts for the given students, sorted by class, roll number, name."""
    from academic_sessions.roster import placements_for, placement_label, placement_roll
    from students.models import Student

    student_ids = list(dict.fromkeys(student_ids))
    if not student_ids:
        return []

    rows_by_student = {}
    rows = (
        FeePayment.objects
        .filter(school_id=school.id, student_id__in=student_ids)
        .select_related('monthly_category', 'annual_category')
    )
    for row in rows:
        rows_by_student.setdefault(row.student_id, []).append(row)

    students = {s.id: s for s in Student.objects.filter(school_id=school.id, id__in=student_ids)}

    kuickpay_numbers = {}
    if KuickpaySchoolMapping.objects.filter(school_id=school.id, is_enabled=True).exists():
        # The one ACTIVE bill per student is the payable reference: Kuickpay recomputes its
        # amount from the ledger, so it covers arrears too, whatever month it was opened in.
        kuickpay_numbers = dict(
            KuickpayBill.objects.filter(
                school_id=school.id, student_id__in=student_ids, status=KuickpayBill.Status.ACTIVE,
            ).values_list('student_id', 'consumer_number')
        )

    computed = {}
    for sid in student_ids:
        if sid not in students:
            continue
        result = compute_voucher(rows_by_student.get(sid, []), year, month)
        if only_unpaid and result['total_payable'] <= ZERO:
            continue
        computed[sid] = result

    placements = placements_for(
        school.id, ((sid, c['academic_year_id']) for sid, c in computed.items()),
    )

    # A date picked when printing wins over the school's due day (printing after that day passed).
    due = due_date or date(year, month, due_day_for(school))
    vouchers = []
    for sid, result in computed.items():
        student = students[sid]
        enrollment = placements.get((sid, result['academic_year_id']))
        vouchers.append({
            'student_id': sid,
            'student_name': student.name,
            'parent_name': student.parent_name or student.guardian_name or '',
            'class_label': placement_label(enrollment, student) or '',
            'roll_number': placement_roll(enrollment, student) or '',
            'admission_number': student.admission_number or '',
            'voucher_number': f"{year}{month:02d}-{sid}",
            'kuickpay_number': kuickpay_numbers.get(sid, ''),
            'month_label': f"{calendar.month_name[month]} {year}",
            'due_date': due,
            **result,
        })

    def _roll_key(value):
        text = str(value or '')
        return (0, int(text)) if text.isdigit() else (1, text)

    vouchers.sort(key=lambda v: (v['class_label'], _roll_key(v['roll_number']), v['student_name']))
    return vouchers


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

def voucher_json(v):
    """One voucher as JSON for the in-app preview (the same figures the PDF prints)."""
    return {
        **{k: v[k] for k in ('student_id', 'student_name', 'parent_name', 'class_label', 'roll_number',
                             'voucher_number', 'kuickpay_number', 'month_label')},
        'due_date': v['due_date'].isoformat(),
        'lines': [{'label': line['label'], 'amount': str(line['amount'])} for line in v['lines']],
        **{k: str(v[k]) for k in ('current_total', 'discount', 'previous_unpaid', 'paid', 'total_payable')},
    }


def _money(value):
    return f"{Decimal(value or 0):,.0f}"


def _fit(c, text, font, size, max_width):
    """Text shortened with an ellipsis until it fits max_width points."""
    text = str(text or '')
    if c.stringWidth(text, font, size) <= max_width:
        return text
    while text and c.stringWidth(text + '…', font, size) > max_width:
        text = text[:-1]
    return text + '…'


def render_vouchers_pdf(school, vouchers):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    from core.pdf_branding import school_logo_png

    page_w, page_h = A4
    strips_per_page = 3
    strip_h = page_h / strips_per_page
    copy_w = page_w / 2
    pad = 5 * mm

    logo = school_logo_png(school)
    logo_reader = ImageReader(io.BytesIO(logo[0])) if logo else None
    bank = voucher_bank_account(school)
    note = ((getattr(school, 'finance_config', None) or {}).get('voucher_note') or '').strip()

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    c.setTitle(f"Fee vouchers - {school.name}")

    def draw_copy(x0, y_top, v, copy_label):
        inner_w = copy_w - 2 * pad
        x = x0 + pad
        y = y_top - pad

        # Header: logo, school name, copy label
        text_x = x
        if logo_reader:
            lh = 9 * mm
            lw = lh * logo[1] / logo[2]
            c.drawImage(logo_reader, x, y - lh, width=lw, height=lh, mask='auto')
            text_x = x + lw + 2 * mm
        label_w = c.stringWidth(copy_label, 'Helvetica-Bold', 7) + 3 * mm
        title_w = x + inner_w - text_x - label_w - 2 * mm
        # Long school names shrink before they get cut: the name is what a bank clerk reads first.
        name_size = 9.5
        while name_size > 7 and c.stringWidth(school.name, 'Helvetica-Bold', name_size) > title_w:
            name_size -= 0.5
        c.setFont('Helvetica-Bold', name_size)
        c.drawString(text_x, y - 3.5 * mm, _fit(c, school.name, 'Helvetica-Bold', name_size, title_w))
        c.setFont('Helvetica', 7)
        c.drawString(text_x, y - 7 * mm, _fit(c, f"Fee Voucher - {v['month_label']}", 'Helvetica', 7, title_w))
        c.setFont('Helvetica-Bold', 7)
        c.roundRect(x + inner_w - label_w, y - 5.5 * mm, label_w, 4.5 * mm, 1 * mm)
        c.drawCentredString(x + inner_w - label_w / 2, y - 4.3 * mm, copy_label)
        y -= 11 * mm

        # Student details: two columns
        c.setLineWidth(0.4)
        c.line(x, y, x + inner_w, y)
        y -= 3.6 * mm
        half = inner_w / 2
        details = [
            ('Voucher #', v['voucher_number'], 'Due date', v['due_date'].strftime('%d %b %Y')),
            ('Student', v['student_name'], 'Class', v['class_label']),
            ('Father/Guardian', v['parent_name'], 'Roll #', v['roll_number']),
        ]
        for l1, v1, l2, v2 in details:
            c.setFont('Helvetica', 6.5)
            c.drawString(x, y, f"{l1}:")
            c.drawString(x + half, y, f"{l2}:")
            c.setFont('Helvetica-Bold', 7)
            off1 = c.stringWidth(f"{l1}: ", 'Helvetica', 6.5)
            off2 = c.stringWidth(f"{l2}: ", 'Helvetica', 6.5)
            c.drawString(x + off1, y, _fit(c, v1, 'Helvetica-Bold', 7, half - off1 - 2 * mm))
            c.drawString(x + half + off2, y, _fit(c, v2, 'Helvetica-Bold', 7, half - off2))
            y -= 3.6 * mm

        # Fee lines
        y -= 0.6 * mm
        c.setFillGray(0.9)
        c.rect(x, y - 1.2 * mm, inner_w, 4 * mm, stroke=0, fill=1)
        c.setFillGray(0)
        c.setFont('Helvetica-Bold', 7)
        c.drawString(x + 1 * mm, y, 'Particulars')
        c.drawRightString(x + inner_w - 1 * mm, y, 'Amount (Rs)')
        y -= 4.2 * mm
        c.setFont('Helvetica', 7)
        for line in v['lines']:
            c.drawString(x + 1 * mm, y, _fit(c, line['label'], 'Helvetica', 7, inner_w - 22 * mm))
            c.drawRightString(x + inner_w - 1 * mm, y, _money(line['amount']))
            y -= 3.4 * mm
        # Fixed space for MAX_LINES keeps every voucher the same shape.
        y -= 3.4 * mm * (MAX_LINES - len(v['lines']))

        c.line(x, y + 2.2 * mm, x + inner_w, y + 2.2 * mm)
        totals = [('Current charges', v['current_total'], False)]
        if v.get('discount', ZERO) > ZERO:
            totals.append(('Less: discount', -v['discount'], False))
        totals.append(('Previous unpaid', v['previous_unpaid'], False))
        if v['paid'] > ZERO:
            totals.append(('Less: already paid', -v['paid'], False))
        totals.append(('Total payable', v['total_payable'], True))
        for label, amount, bold in totals:
            font = 'Helvetica-Bold' if bold else 'Helvetica'
            size = 8 if bold else 7
            c.setFont(font, size)
            c.drawString(x + 1 * mm, y, label)
            c.drawRightString(x + inner_w - 1 * mm, y, _money(amount))
            y -= 3.4 * mm

        # Payment boxes: bank and Kuickpay kept apart so a parent never mixes the two references.
        box_h = 15 * mm
        y_box = y - box_h + 0.5 * mm
        boxes = []
        if bank:
            boxes.append(('Pay at bank', [
                bank.bank_name,
                f"Title: {bank.account_title}" if bank.account_title else '',
                f"A/C: {bank.account_number}" if bank.account_number else '',
                f"IBAN: {bank.iban}" if bank.iban else '',
            ]))
        if v['kuickpay_number']:
            boxes.append(('Pay via Kuickpay', [
                'Kuickpay voucher #',
                v['kuickpay_number'],
                'Any bank app, ATM or agent',
            ]))
        if not boxes:
            boxes.append(('Payment', ['Pay at the school accounts office.']))
        gap = 2 * mm
        box_w = (inner_w - gap * (len(boxes) - 1)) / len(boxes)
        for i, (title, rows_) in enumerate(boxes):
            bx = x + i * (box_w + gap)
            c.setLineWidth(0.5)
            c.roundRect(bx, y_box, box_w, box_h, 1.2 * mm)
            ty = y_box + box_h - 3 * mm
            c.setFont('Helvetica-Bold', 6.8)
            c.drawString(bx + 1.5 * mm, ty, title)
            for j, text in enumerate(r for r in rows_ if r):
                ty -= 2.6 * mm
                is_number = title == 'Pay via Kuickpay' and j == 1
                font, size = ('Helvetica-Bold', 8) if is_number else ('Helvetica', 6.3)
                c.setFont(font, size)
                c.drawString(bx + 1.5 * mm, ty, _fit(c, text, font, size, box_w - 3 * mm))

        # Footer: note + signature
        fy = y_top - strip_h + pad + 1 * mm
        c.setFont('Helvetica-Oblique', 6)
        if note:
            c.drawString(x, fy + 3 * mm, _fit(c, note, 'Helvetica-Oblique', 6, inner_w))
        c.setFont('Helvetica', 6.5)
        c.drawString(x, fy, f"Please pay by {v['due_date'].strftime('%d %b %Y')}.")
        c.line(x + inner_w - 28 * mm, fy + 0.5 * mm, x + inner_w, fy + 0.5 * mm)
        c.drawRightString(x + inner_w, fy - 2.5 * mm, 'Signature / Stamp')

    for index, v in enumerate(vouchers):
        slot = index % strips_per_page
        if index and slot == 0:
            c.showPage()
        y_top = page_h - slot * strip_h
        draw_copy(0, y_top, v, 'SCHOOL COPY')
        draw_copy(copy_w, y_top, v, 'STUDENT COPY')

        # Cut lines: between the two copies and under the strip.
        c.saveState()
        c.setDash(3, 3)
        c.setLineWidth(0.4)
        c.setStrokeGray(0.5)
        c.line(copy_w, y_top - 3 * mm, copy_w, y_top - strip_h + 3 * mm)
        if slot < strips_per_page - 1:
            c.line(3 * mm, y_top - strip_h, page_w - 3 * mm, y_top - strip_h)
        c.restoreState()

    if not vouchers:
        c.setFont('Helvetica', 11)
        c.drawCentredString(page_w / 2, page_h / 2, 'No vouchers: nothing is due for the selected students.')
    c.showPage()
    c.save()
    return buffer.getvalue()
