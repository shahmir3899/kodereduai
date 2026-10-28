import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ResultsView } from '../../../../components/student/StudentResultsScreen';
import { useChildResults } from '../../../../hooks/useParent';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ResultsView query={useChildResults(Number(id))} />;
}
