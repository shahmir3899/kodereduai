import React from 'react';
import FolderStack from '../../../components/nav/FolderStack';

export default function Layout() {
  return <FolderStack titles={{ history: 'Notification History', send: 'Send Notification', 'template-send': 'Send from Template' }} />;
}
