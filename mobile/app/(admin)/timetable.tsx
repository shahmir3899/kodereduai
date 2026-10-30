import React from 'react';
import TimetableEditorScreen from '../../components/academics/TimetableEditorScreen';

// Replaces the old read-only screen, which compared the API's day codes (MON) with day names
// (Monday) and so showed "No timetable" for every class.
export default function Timetable() {
  return <TimetableEditorScreen />;
}
