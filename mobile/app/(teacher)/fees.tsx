import React from 'react';
import FeeCollectScreen from '../../components/finance/FeeCollectScreen';
import TeacherClassGate from '../../components/nav/TeacherClassGate';

// A teacher may only see and update fees of their own sections; the server enforces it too.
export default function TeacherFees() {
  return <TeacherClassGate>{(options) => <FeeCollectScreen classOptions={options} />}</TeacherClassGate>;
}
