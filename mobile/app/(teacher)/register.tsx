import React from 'react';
import AttendanceRegisterScreen from '../../components/attendance/AttendanceRegisterScreen';
import TeacherClassGate from '../../components/nav/TeacherClassGate';

// The server scopes the register to the teacher's sections as well.
export default function TeacherRegister() {
  return <TeacherClassGate>{(options) => <AttendanceRegisterScreen classOptions={options} />}</TeacherClassGate>;
}
