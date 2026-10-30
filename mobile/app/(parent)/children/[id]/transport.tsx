import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TransportView } from '../../../../components/student/StudentTransportScreen';
import { useChildTransport } from '../../../../hooks/useParent';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TransportView query={useChildTransport(Number(id))} />;
}
