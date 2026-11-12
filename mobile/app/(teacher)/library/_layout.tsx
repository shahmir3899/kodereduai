import React from 'react';
import FolderStack from '../../../components/nav/FolderStack';

export default function Layout() {
  return <FolderStack titles={{ index: 'Library', catalog: 'Catalog', issue: 'Books Out', overdue: 'Overdue Books' }} />;
}
