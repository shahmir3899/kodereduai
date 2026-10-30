import React from 'react';
import FolderStack from '../../../components/nav/FolderStack';

export default function Layout() {
  return <FolderStack titles={{ dashboard: 'HR Dashboard', staff: 'Staff Directory', 'staff-form': 'Staff Member', departments: 'Departments and Designations', 'leave-policies': 'Leave Policies', documents: 'Documents and Qualifications', appraisals: 'Performance', 'leave-approvals': 'Leave Approvals', letters: 'Letters', payroll: 'Payroll', salary: 'Salary' }} />;
}
