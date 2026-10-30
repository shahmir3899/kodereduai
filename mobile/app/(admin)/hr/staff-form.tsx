import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import StaffFormScreen from '../../../components/hr/StaffFormScreen';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <StaffFormScreen id={id ? Number(id) : null} />;
}
