// Shape of GET /api/sessions/health/ (see SessionHealthWidget.jsx on the web); only what the
// dashboard card reads.
export interface SessionHealthReport {
  success?: boolean;
  academic_year?: { name?: string };
  enrollment?: { retention_rate?: number | null };
  attendance?: { average_attendance_rate?: number | null };
  fee_collection?: { collection_rate?: number | null };
  exam_performance?: { average_pass_rate?: number | null };
  ai_summary?: { highlights?: string[]; concerns?: string[]; action_items?: string[] } | null;
}

const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Math.round(Number(v))}%`);

export function healthTiles(r: SessionHealthReport): Array<{ label: string; value: string }> {
  return [
    { label: 'Retention', value: pct(r.enrollment?.retention_rate) },
    { label: 'Attendance', value: pct(r.attendance?.average_attendance_rate) },
    { label: 'Fee collection', value: pct(r.fee_collection?.collection_rate) },
    { label: 'Pass rate', value: pct(r.exam_performance?.average_pass_rate) },
  ];
}
