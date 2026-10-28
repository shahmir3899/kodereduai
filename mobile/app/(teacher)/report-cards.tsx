import React from 'react';
import ReportCardScreen from '../../components/exams/ReportCardScreen';
import { useTeacherClassOptions } from '../../hooks/useTeacher';

// A teacher sees report cards for their own sections; the server scopes the data as well.
export default function TeacherReportCards() {
  return <ReportCardScreen useClassOptions={useTeacherClassOptions} autoSelectFirst />;
}
