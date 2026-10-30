import React from 'react';
import ExamTypesScreen from '../../components/exams/ExamTypesScreen';

// Managers see the types; only admin and principal change them (as on the web).
export default function Screen() {
  return <ExamTypesScreen canEdit={false} />;
}
