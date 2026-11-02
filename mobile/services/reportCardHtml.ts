import {
  DEFAULT_SIGNATURE_LABELS, examCell, examTotal, formatIssueDate, shortExamName, type ReportExam, type ReportTemplate,
} from './reportCard';

// The report card as an HTML page, drawn on the phone from the same data the screen shows
// (`GET examinations/report-card/`). expo-print turns the page into the PDF. Two layouts, as the
// web's templates: 'enhanced' (indigo, tiles, striped table) and 'traditional' (double-ruled navy
// frame, gold labels, grid table). Pure: no React and no native modules, so it is unit-tested.

type N = number | string | null | undefined;

export interface CardSubject {
  subject_id: number; subject_name: string; total_marks?: N; marks_obtained?: N; percentage?: N; grade?: string | null;
  class_avg?: N; is_pass?: boolean | null; is_absent?: boolean; comment?: string | null;
}
export interface CardExam extends ReportExam { exam_name: string; is_main?: boolean }
export interface CardAttendance {
  working_days?: number | null; present?: number; absent?: number; leave?: number; not_marked?: number; percentage?: N;
  from?: string; to?: string; suspect?: boolean;
}
export interface CardRating { label: string; rating?: number | null }
export interface CardReport {
  student_name?: string; class_name?: string; roll_number?: string | null; guardian_name?: string | null;
  school_name?: string; academic_year_name?: string; term_name?: string | null; exam_display?: string | null;
  issue_date?: string | null; is_draft?: boolean; weighted?: boolean; class_size?: number | null; class_avg_unit?: string;
  subjects?: CardSubject[]; exams?: CardExam[]; earlier_exam_names?: string[];
  summary?: { rank?: number | null; grade?: string | null; total_marks?: N; obtained_marks?: N; percentage?: N; overall_pass?: boolean | null } | null;
  attendance?: CardAttendance | null;
  conduct_assessment?: { month?: number | null; skills?: CardRating[]; behaviour?: CardRating[]; teacher_remark?: string; principal_remark?: string } | null;
  promotion_applicable?: boolean; promotion_status?: string | null;
  overall_comment?: string | null; signature_labels?: Record<string, string>;
  grade_scales?: Array<{ grade_label?: string; min_percentage?: N; max_percentage?: N }>;
}
export interface CardSchool { name?: string; address?: string | null; logo?: string | null }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const GOOD = '#1f8a5f';
const BAD = '#be3c37';
const AMBER = '#e6a01e';
const MUTED = '#73787f';
const HAIRLINE = '#cdd6de';

const PALETTE: Record<ReportTemplate, { ink: string; accent: string; soft: string }> = {
  enhanced: { ink: '#4f46e5', accent: '#6e64dc', soft: '#f6f6fb' },
  traditional: { ink: '#17324f', accent: '#8a6d1f', soft: '#f4ecd6' },
};

export function esc(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function ordinal(n: N): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? '');
  if (v % 100 >= 11 && v % 100 <= 13) return `${v}th`;
  return `${v}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[v % 10] ?? 'th'}`;
}

export const positionText = (rank: N, classSize?: number | null): string =>
  classSize ? `${ordinal(rank)} of ${classSize}` : ordinal(rank);

const num = (v: N): string => {
  if (v == null || v === '') return '-';
  const f = Number(v);
  return Number.isFinite(f) ? String(Math.round(f * 100) / 100) : String(v);
};
const numOrDash = (v: N, digits: number): string => (v == null || v === '' || !Number.isFinite(Number(v)) ? '-' : Number(v).toFixed(digits));

// 'Grade key:  A+ 90–100%   ·   A 80–89% ...', highest band first, from the school's own scale.
export function gradeKeyText(scales: CardReport['grade_scales']): string {
  const usable = (scales ?? []).filter((g) => g.grade_label && g.min_percentage != null && g.max_percentage != null);
  if (usable.length === 0) return '';
  const parts = [...usable]
    .sort((a, b) => Number(b.min_percentage) - Number(a.min_percentage))
    .map((g) => `${g.grade_label} ${num(g.min_percentage)}–${num(g.max_percentage)}%`);
  return `Grade key:  ${parts.join('   ·   ')}`;
}

const passText = (v: boolean | null | undefined) => (v === true ? 'Pass' : v === false ? 'Fail' : '-');

function dots(rating: N, color: string): string {
  const n = Number(rating) || 0;
  return [1, 2, 3, 4, 5].map((i) => `<span class="dot" style="background:${i <= n ? color : '#ccd1d9'}"></span>`).join('');
}

function marksTable(report: CardReport, trad: boolean, ink: string, soft: string): string {
  const subjects = report.subjects ?? [];
  const exams = report.exams ?? [];
  const summary = report.summary ?? null;
  const weighted = !!report.weighted;
  const multi = exams.length > 1;
  const unit = report.class_avg_unit === 'percent' ? '%' : '';
  const avg = (v: N) => (v == null ? '-' : `${num(v)}${unit}`);
  const subjectIds = subjects.map((s) => s.subject_id);

  let head: string[];
  let cols: Array<(s: CardSubject) => string>;
  let foot: string[] | null = null;
  let failCol: number | null = null;

  if (!multi) {
    head = ['Subject', trad ? 'Max Marks' : 'Total', 'Obtained', '%', 'Grade', ...(trad ? [] : ['Class Avg', 'Status'])];
    cols = [
      (s) => s.subject_name, (s) => num(s.total_marks), (s) => (s.is_absent ? 'Absent' : num(s.marks_obtained)),
      (s) => numOrDash(s.percentage, 1), (s) => s.grade || '-',
      ...(trad ? [] : [(s: CardSubject) => avg(s.class_avg), (s: CardSubject) => passText(s.is_pass)]),
    ];
    if (summary) {
      foot = ['Total', num(summary.total_marks), num(summary.obtained_marks), numOrDash(summary.percentage, 1), summary.grade || '-',
        ...(trad ? [] : ['', passText(summary.overall_pass)])];
    }
  } else {
    head = ['Subject', ...exams.map((e) => esc(shortExamName(e.exam_name)) + (weighted ? `<br>${esc(e.weight)}%` : '')), weighted ? 'Result %' : '%', 'Grade', 'Class Avg'];
    cols = [
      (s) => s.subject_name, ...exams.map((e) => (s: CardSubject) => examCell(e, s.subject_id)),
      (s) => numOrDash(s.percentage, 1), (s) => s.grade || '-', (s) => avg(s.class_avg),
    ];
    if (summary) foot = ['Total', ...exams.map((e) => examTotal(e, subjectIds)), numOrDash(summary.percentage, 1), summary.grade || '-', ''];
    failCol = exams.length + 1;
  }

  const rows = subjects.map((s, i) => {
    const cells = cols.map((fn, c) => {
      let style = '';
      if (c === 0 && trad) style += 'font-weight:700;';
      if (multi && c >= 1 && c <= exams.length) {
        const e = exams[c - 1];
        style += e.is_main ? 'font-weight:700;' : `color:${MUTED};`;
      }
      if (failCol === c && s.is_pass === false) style += `color:${BAD};`;
      return `<td${c === 0 ? ' class="left"' : ''}${style ? ` style="${style}"` : ''}>${esc(fn(s))}</td>`;
    }).join('');
    const stripe = !trad && i % 2 ? ` style="background:#f5f5fa"` : '';
    const comment = s.comment ? `<tr${stripe}><td colspan="${cols.length}" class="comment">${esc(s.comment)}</td></tr>` : '';
    return `<tr${stripe}>${cells}</tr>${comment}`;
  }).join('');
  const footer = foot ? `<tr class="foot" style="background:${soft}">${foot.map((c, i) => `<td${i === 0 ? ' class="left"' : ''}>${esc(c)}</td>`).join('')}</tr>` : '';
  const header = head.map((h) => `<th style="background:${ink}">${h.includes('<br>') ? h : esc(h)}</th>`).join('');
  return `<table class="marks${trad ? ' grid' : ''}"><thead><tr>${header}</tr></thead><tbody>${rows}${footer}</tbody></table>`;
}

function noteBox(label: string, text: string, ink: string, accent: string, soft: string, trad: boolean): string {
  const body = text ? esc(text) : '&nbsp;';
  return trad
    ? `<div class="note avoid" style="border:0.4pt solid ${ink}"><div class="label" style="color:${accent}">${esc(label)}</div><div>${body}</div></div>`
    : `<div class="note avoid" style="background:${soft};border-left:1.5pt solid ${ink}"><div class="label" style="color:${accent}">${esc(label)}</div><div class="italic">${body}</div></div>`;
}

export function renderReportCardHtml(input: { report: CardReport; school?: CardSchool | null; template: ReportTemplate; today: string }): string {
  const { report, school, template, today } = input;
  const trad = template === 'traditional';
  const { ink, accent, soft } = PALETTE[template];
  const sig = { ...DEFAULT_SIGNATURE_LABELS, ...(report.signature_labels ?? {}) };
  const subjects = report.subjects ?? [];
  const exams = report.exams ?? [];
  const att = report.attendance ?? null;
  const conduct = report.conduct_assessment ?? null;
  const summary = report.summary ?? null;
  const schoolName = report.school_name || school?.name || 'Report Card';
  const address = school?.address || '';
  const classSize = report.class_size;
  const issue = report.issue_date || today;
  const exam = report.exam_display || report.term_name || '';
  const student = report.student_name || '-';
  const logo = school?.logo ? `<img class="logo" src="${esc(school.logo)}" />` : '';
  const out: string[] = [];

  if (report.is_draft) out.push(`<div class="draft"><b>DRAFT</b> – results have not been announced yet.</div>`);

  if (trad) {
    const guardian = report.guardian_name || '-';
    out.push(`<div class="center">${logo}<div class="school" style="color:${ink}">${esc(schoolName)}</div>${address ? `<div class="sub">${esc(address)}</div>` : ''}</div>`);
    out.push(`<hr style="border:0;border-top:0.8pt solid ${ink};margin:8px 0">`);
    out.push(`<div class="center label" style="color:${accent};font-size:10.5pt">${esc((exam ? `PROGRESS REPORT · ${exam}` : 'PROGRESS REPORT').toUpperCase())}</div>`);
    out.push(`<table class="info"><tr><td class="k">Student</td><td>${esc(student)}</td><td class="k">Class / Section</td><td>${esc(report.class_name || '-')}</td></tr>
      <tr><td class="k">Roll No.</td><td>${esc(report.roll_number || '-')}</td><td class="k">Guardian</td><td>${esc(guardian)}</td></tr>
      <tr><td class="k">Academic Year</td><td>${esc(report.academic_year_name || '')}</td><td class="k">Term</td><td>${esc(report.term_name || '-')}</td></tr>
      <tr><td class="k">Date of Issue</td><td colspan="3"><b>${esc(formatIssueDate(issue))}</b></td></tr></table>`);
  } else {
    out.push(`<div class="head">${logo}<div><div class="school" style="color:${ink}">${esc(schoolName)}</div><div class="sub">${esc(`${report.class_name || '-'}  ·  Roll No. ${report.roll_number || '-'}`)}</div></div></div>`);
    out.push(`<hr style="border:0;border-top:0.6pt solid ${ink};margin:6px 0 8px">`);
    const termLine = [report.academic_year_name, exam].filter(Boolean).join(' · ');
    out.push(`<table class="title"><tr><td class="t" style="color:${ink}">${esc(`Report Card – ${student}`)}</td><td class="r">${esc(termLine)}<br>Date of Issue: <b style="color:${ink}">${esc(formatIssueDate(issue))}</b></td></tr></table>`);
    if (report.guardian_name) out.push(`<div class="sub">${esc(`Guardian: ${report.guardian_name}`)}</div>`);
  }

  const earlier = report.earlier_exam_names ?? [];
  if (earlier.length) {
    const main = exams.find((e) => e.is_main)?.exam_name || '';
    const note = report.weighted
      ? `Weighted result across: ${[...earlier, ...(main ? [main] : [])].join(', ')}`
      : `Result is from ${main}. Earlier exams shown for reference: ${earlier.join(', ')}`;
    out.push(`<div class="sub" style="margin:6px 0">${esc(note)}</div>`);
  }

  const rank = summary?.rank;
  const hasAtt = !!att && (att.working_days || 0) > 0;
  if (trad) {
    const boxes: Array<[string, string]> = [];
    if (hasAtt) boxes.push(['ATTENDANCE', `${att!.present ?? 0} / ${att!.working_days} days${att!.percentage != null ? ` (${att!.percentage}%)` : ''}`]);
    if (rank) boxes.push(['POSITION', positionText(rank, classSize)]);
    if (boxes.length) out.push(`<table class="tiles boxed" style="border:0.4pt solid ${ink}"><tr>${boxes.map(([k, v]) => `<td style="border:0.4pt solid ${ink}"><div class="tl">${k}</div><div class="tv" style="color:${ink}">${esc(v)}</div></td>`).join('')}</tr></table>`);
  } else {
    const tiles: Array<[string, string]> = [];
    if (rank) tiles.push(['POSITION', positionText(rank, classSize)]);
    if (summary?.grade) tiles.push(['OVERALL', String(summary.grade)]);
    if (tiles.length) out.push(`<table class="tiles"><tr>${tiles.map(([k, v]) => `<td style="background:${soft}"><div class="tl">${k}</div><div class="tv" style="color:${ink}">${esc(v)}</div></td>`).join('<td class="gap"></td>')}</tr></table>`);
    if (hasAtt) {
      const days = att!.working_days as number;
      const seg = (n: number | undefined, color: string) => (n && days ? `<span style="display:inline-block;height:100%;width:${(n / days) * 100}%;background:${color}"></span>` : '');
      const legend = [['Present', att!.present ?? 0], ['Absent', att!.absent ?? 0], ['Leave', att!.leave ?? 0], ...((att!.not_marked || 0) > 0 ? [['Not marked', att!.not_marked]] : [])]
        .map(([l, n]) => `${l}: ${n}`).join('&nbsp;&nbsp;&nbsp;&nbsp;');
      const period = att!.from && att!.to ? `${formatIssueDate(att!.from)} – ${formatIssueDate(att!.to)}` : '';
      out.push(`<div class="att" style="background:${soft}"><div class="row"><span class="tl">ATTENDANCE</span><span class="tl">${esc(period)}</span></div>
        <div style="color:${GOOD};font-size:12pt"><b>${att!.present ?? 0} / ${days} days${att!.percentage != null ? `  (${att!.percentage}%)` : ''}</b></div>
        <div class="bar">${seg(att!.present, GOOD)}${seg(att!.absent, BAD)}${seg(att!.leave, AMBER)}</div>
        <div class="sub">${legend}</div>
        ${att!.suspect ? `<div class="sub" style="color:#b46e14">Attendance was not recorded on ${att!.not_marked ?? 0} of ${days} working days.</div>` : ''}</div>`);
    }
  }

  if (subjects.length) {
    out.push(marksTable(report, trad, ink, soft));
    const key = gradeKeyText(report.grade_scales);
    if (key) out.push(`<div class="sub" style="font-size:7.5pt;margin-top:6px">${esc(key)}</div>`);
  }

  if (report.promotion_applicable && report.promotion_status && report.promotion_status !== 'NOT_APPLICABLE') {
    const promoted = report.promotion_status === 'PROMOTED';
    out.push(`<table class="promo avoid" style="border:0.8pt solid ${promoted ? GOOD : BAD}"><tr><td class="label" style="color:${accent}">PROMOTION STATUS</td><td class="r" style="color:${promoted ? GOOD : BAD};font-size:11pt"><b>${promoted ? 'PROMOTED' : 'NOT PROMOTED'}</b></td></tr></table>`);
  }

  const skills = conduct?.skills ?? [];
  const behaviour = conduct?.behaviour ?? [];
  if (skills.length || behaviour.length) {
    const month = conduct?.month;
    const heading = `SKILLS & BEHAVIOUR ASSESSMENT${month ? ` — ${MONTHS[month - 1].toUpperCase()}` : ''}`;
    const rows: string[] = [];
    for (let i = 0; i < Math.max(skills.length, behaviour.length); i++) {
      const cell = (items: CardRating[]) => (i < items.length ? `<td>${esc(items[i].label)}</td><td>${dots(items[i].rating, ink)}</td>` : '<td></td><td></td>');
      rows.push(`<tr>${cell(skills)}${cell(behaviour)}</tr>`);
    }
    out.push(`<div class="avoid"><div class="label" style="color:${accent};margin-top:10px">${esc(heading)}</div><table class="sb">${rows.join('')}</table></div>`);
  }

  const teacherRemark = conduct?.teacher_remark || '';
  const principalRemark = conduct?.principal_remark || '';
  const notes: string[] = [];
  if (report.overall_comment) notes.push(noteBox('OVERALL PERFORMANCE', report.overall_comment, ink, accent, soft, trad));
  if (teacherRemark || trad) notes.push(noteBox("CLASS TEACHER'S REMARKS", teacherRemark, ink, accent, soft, trad));
  if (principalRemark) notes.push(noteBox("PRINCIPAL'S REMARKS", principalRemark, ink, accent, soft, trad));
  out.push(...notes.map((n) => `${n}<div style="height:6px"></div>`));

  const labels = [sig.class_teacher, sig.principal, trad ? 'Parent / Guardian' : sig.parent];
  out.push(`<table class="sign avoid"><tr>${labels.map((l) => `<td style="border-top:0.5pt solid ${ink}">${esc(String(l).toUpperCase())}</td>`).join('<td class="gap"></td>')}</tr></table>`);

  const body = trad
    ? `<div style="border:1pt solid ${ink};padding:3pt"><div style="border:0.4pt solid ${ink};padding:10pt">${out.join('')}</div></div>`
    : out.join('');

  const css = `
@page { size: A4; margin: ${trad ? 16 : 14}mm 14mm 14mm; }
* { box-sizing: border-box; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 9pt; line-height: 1.3; color: #1f1f24; margin: 0; }
.avoid { break-inside: avoid; page-break-inside: avoid; }
.center { text-align: center; } .left { text-align: left !important; }
.school { font-weight: 700; font-size: 16pt; line-height: 1.2; }
.sub { color: ${MUTED}; font-size: 8.5pt; } .center .sub { text-align: center; }
.logo { height: 16mm; display: block; ${trad ? 'margin: 0 auto 6px;' : 'margin-right: 10px;'} }
.head { display: flex; align-items: center; }
.draft { text-align: center; color: ${BAD}; font-size: 8pt; margin-bottom: 6px; }
.label { font-weight: 700; font-size: 7.5pt; letter-spacing: 0.3pt; margin-bottom: 3px; }
table { width: 100%; border-collapse: collapse; }
.info td { border: 0.3pt solid ${HAIRLINE}; padding: 4pt 5pt; width: 30%; } .info td.k { width: 20%; font-weight: 700; }
.title td { vertical-align: top; padding: 0; } .title .t { font-weight: 700; font-size: 12.5pt; } .title .r { text-align: right; color: ${MUTED}; font-size: 9.5pt; }
.tiles { margin: 6px 0; } .tiles td { padding: 6pt 8pt; vertical-align: top; } .tiles td.gap { width: 4pt; padding: 0; background: #fff !important; }
.tl { font-size: 7.5pt; color: ${MUTED}; } .tv { font-weight: 700; font-size: 13pt; }
.att { padding: 4pt 5mm; margin: 6px 0; } .att .row { display: flex; justify-content: space-between; }
.bar { height: 3mm; border-radius: 1.5mm; background: #dde0e8; overflow: hidden; margin: 3px 0; white-space: nowrap; font-size: 0; }
.marks { margin-top: 8px; font-size: ${'9pt'}; } .marks th { color: #fff; font-weight: 700; padding: 4pt 3pt; text-align: center; }
.marks td { text-align: center; padding: 4pt 3pt; } .marks.grid th, .marks.grid td { border: 0.3pt solid ${HAIRLINE}; }
.marks .foot td { font-weight: 700; } .marks .comment { text-align: left; font-style: italic; font-size: 8pt; color: #5e6373; padding: 1pt 3pt 4pt; }
.promo { margin: 8px 0; } .promo td { padding: 6pt 8pt; } .promo .r { text-align: right; }
.sb td { padding: 1pt 2pt; font-size: 8pt; width: 28%; } .sb td + td { width: 22%; }
.dot { display: inline-block; width: 2.2mm; height: 2.2mm; border-radius: 50%; margin-right: 0.8mm; }
.note { padding: 4pt 5mm 6pt; margin-top: 6px; } .note .italic { font-style: italic; font-size: 9.5pt; color: #33333d; }
.sign { margin-top: 28px; } .sign td { text-align: center; font-size: 7.5pt; color: ${MUTED}; padding-top: 3pt; width: 32%; } .sign td.gap { width: 2%; border: 0 !important; }
`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(`Report Card - ${student}`)}</title><style>${css}</style></head><body>${body}</body></html>`;
}
