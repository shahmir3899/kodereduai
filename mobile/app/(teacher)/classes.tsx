import React, { useMemo } from 'react';
import ClassesScreen from '../../components/students/ClassesScreen';
import TeacherClassGate from '../../components/nav/TeacherClassGate';
import type { ClassOption } from '../../services/attendanceEntry';

function Scoped({ options }: { options: ClassOption[] }) {
  const ids = useMemo(() => new Set(options.map((o) => o.classObj ?? o.id)), [options]);
  return <ClassesScreen allowedMasterIds={ids} />;
}

// A teacher sees the sections they are assigned to.
export default function TeacherClasses() {
  return <TeacherClassGate>{(options) => <Scoped options={options} />}</TeacherClassGate>;
}
