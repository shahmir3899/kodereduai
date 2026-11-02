// File names and query params for the server-made PDFs shared from the exam and timetable screens.

const safe = (text: string, fallback: string) =>
  (text || fallback).trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;

// The server names its own download "DateSheet_<group>.pdf"; the phone saves the same way.
export const dateSheetFileName = (groupName: string) => `DateSheet_${safe(groupName, 'Exam')}.pdf`;

export const timetableFileName = (classLabel: string) => `Timetable_${safe(classLabel, 'Class')}.pdf`;

// The server needs the master class, and a section id to title the PDF with the section.
export function timetablePdfParams(classObj: number | null, sessionClass: number | null): Record<string, number> | null {
  if (classObj == null) return null;
  return { class_id: classObj, ...(sessionClass != null ? { session_class_id: sessionClass } : {}) };
}

// The monthly register of a class or section: the server needs the class (or section), month and year.
export function registerPdfParams(
  option: { id: number; classObj: number | null; isSession: boolean } | null, year: number, month1: number, academicYearId: number | null,
): Record<string, number> | null {
  if (!option) return null;
  return {
    ...(option.isSession ? { session_class_id: option.id, class_id: option.classObj ?? option.id } : { class_id: option.classObj ?? option.id }),
    month: month1, year, ...(academicYearId ? { academic_year: academicYearId } : {}),
  };
}

export const registerFileName = (classLabel: string, year: number, month1: number) =>
  `Attendance_${safe(classLabel, 'Class')}_${year}-${String(month1).padStart(2, '0')}.pdf`;
