import React from 'react';
import ExamsAdminScreen from '../../components/exams/ExamsAdminScreen';

// A manager can read exams but not change them (the server answers admin and principal only).
export default function Screen() {
  return <ExamsAdminScreen readOnly />;
}
