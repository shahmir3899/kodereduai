import React from 'react';
import ReportCardScreen from '../../components/exams/ReportCardScreen';
import { useClassOptionsForYear } from '../../hooks/useAcademicYear';

export default function AdminReportCards() {
  return <ReportCardScreen useClassOptions={useClassOptionsForYear} />;
}
