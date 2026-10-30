import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import DateSheetScreen from '../../components/exams/DateSheetScreen';

export default function Screen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  return <DateSheetScreen groupId={Number(groupId)} />;
}
