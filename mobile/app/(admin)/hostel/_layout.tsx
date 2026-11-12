import React from 'react';
import FolderStack from '../../../components/nav/FolderStack';

export default function Layout() {
  return <FolderStack titles={{ index: 'Hostel', rooms: 'Hostels and Rooms', allocations: 'Allocations', 'gate-passes': 'Gate Passes' }} />;
}
