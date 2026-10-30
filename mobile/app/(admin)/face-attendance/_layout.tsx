import React from 'react';
import FolderStack from '../../../components/nav/FolderStack';

export default function Layout() {
  return <FolderStack titles={{ capture: 'Face Attendance', enrollment: 'Face Enrollment', review: 'Review Face Attendance' }} />;
}
