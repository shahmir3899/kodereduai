import React from 'react';
import FolderStack from '../../../components/nav/FolderStack';

export default function Layout() {
  return <FolderStack titles={{ index: 'Finance', accounts: 'Accounts', 'close-month': 'Close Month', discounts: 'Discounts', expense: 'Record Expense', 'fee-collection': 'Fee Collection', 'fee-generate': 'Generate Fee Records', 'fee-setup': 'Fee Setup', income: 'Record Income', reports: 'Financial Reports', 'student-fees': 'Amounts for Single Students', transactions: 'Transaction History', transfers: 'Account Transfers' }} />;
}
