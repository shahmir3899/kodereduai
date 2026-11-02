import React from 'react';
import AssignmentsListScreen from '../../../components/lms/AssignmentsListScreen';

// A manager prepares drafts; a teacher publishes them (the server enforces it).
export default function Screen() {
  return <AssignmentsListScreen draftOnly />;
}
