// File names for student report PDFs and ZIPs. Same rules as the web app:
//   single PDF: "<Roll> - <Student name> - <Class> (<Duration>).pdf"
//   zip:        "<Class> - (<Duration>) - <N> reports.zip"
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Strips characters Windows/macOS reject in file names and tidies whitespace.
export const safePart = (text: unknown): string =>
  String(text ?? '').replace(/[\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();

// "Class 2 - A" -> "Class 2-A": the spaced dash would read as a name-part separator.
export const classLabel = (className: unknown): string => safePart(String(className ?? '').replace(/\s+-\s+/g, '-'));

const nums = (iso: string) => iso.split('-').map(Number);

export function durationLabel(params: Record<string, unknown>, academicYearName = ''): string {
  const from = params.date_from as string | undefined;
  const to = params.date_to as string | undefined;
  if (from && to) {
    const [fy, fm, fd] = nums(from);
    const [ty, tm, td] = nums(to);
    if (fy === ty && fm === tm && fd === 1 && td === new Date(fy, fm, 0).getDate()) return `${MONTHS[fm - 1]} ${fy}`;
    const left = `${String(fd).padStart(2, '0')} ${MONTHS[fm - 1]}${fy === ty ? '' : ` ${fy}`}`;
    return `${left}-${String(td).padStart(2, '0')} ${MONTHS[tm - 1]} ${ty}`;
  }
  if (params.academic_year) return academicYearName ? `AY ${safePart(academicYearName)}` : 'Academic year';
  return 'All time';
}

export interface NamedStudent { name: string; roll?: string | number | null; className?: string | null }

export function singleReportFileName(s: NamedStudent, duration: string): string {
  const head = [safePart(s.roll), safePart(s.name) || 'Student', classLabel(s.className)].filter(Boolean).join(' - ');
  return `${head} (${duration}).pdf`;
}

export function reportsZipFileName(students: NamedStudent[], duration: string): string {
  const classes = [...new Set(students.map((s) => classLabel(s.className)).filter(Boolean))];
  const cls = classes.length === 1 ? classes[0] : classes.length > 1 ? 'Multiple classes' : 'Students';
  const n = students.length;
  return `${cls} - (${duration}) - ${n} ${n === 1 ? 'report' : 'reports'}.zip`;
}

// A repeat gets " [2]" so no entry overwrites another inside the zip.
export function uniqueNames(names: string[]): string[] {
  const used = new Map<string, number>();
  return names.map((full) => {
    const dot = full.lastIndexOf('.');
    const base = dot > 0 ? full.slice(0, dot) : full;
    const ext = dot > 0 ? full.slice(dot) : '';
    const n = (used.get(full) ?? 0) + 1;
    used.set(full, n);
    return n > 1 ? `${base} [${n}]${ext}` : full;
  });
}
