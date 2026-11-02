import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import StudentFormScreen from '../../../../components/students/StudentFormScreen';

export default function EditStudent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StudentFormScreen studentId={Number(id)} />;
}
