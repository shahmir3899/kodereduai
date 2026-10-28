import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { LibraryView } from '../../../../components/student/StudentLibraryScreen';
import { useChildLibrary } from '../../../../hooks/useParent';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <LibraryView query={useChildLibrary(Number(id))} />;
}
