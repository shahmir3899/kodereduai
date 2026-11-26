import React from 'react';
import RoleStack from './RoleStack';

// Kept for the folders that only name their screens; the header rules live in RoleStack.
export default function FolderStack({ titles }: { titles: Record<string, string> }) {
  return <RoleStack titles={titles} />;
}
