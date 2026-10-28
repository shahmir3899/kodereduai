import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { FeesView } from '../../../../components/student/StudentFeesScreen';
import { useChildFees } from '../../../../hooks/useParent';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <FeesView query={useChildFees(Number(id))} />;
}
