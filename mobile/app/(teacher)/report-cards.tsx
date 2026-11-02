import React from 'react';
import ReportCardScreen from '../../components/exams/ReportCardScreen';
import { useTeacherClassOptions } from '../../hooks/useTeacher';

// A teacher sees report cards for their own sections; the server scopes the data as well.
// The web lets a teacher download the whole class too, and the bulk endpoints take the same permissions.
export default function TeacherReportCards() {
  return <ReportCardScreen useClassOptions={useTeacherClassOptions} autoSelectFirst canBulk />;
}
