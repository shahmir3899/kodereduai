import React from 'react';
import FolderStack from '../../../components/nav/FolderStack';

export default function Layout() {
  return <FolderStack titles={{ index: 'Transport', routes: 'Routes', route: 'Route and Stops' }} />;
}
