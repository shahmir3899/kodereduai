import {
  accountableIds, accountsErrorText, buildBulkAccountsPayload, bulkAccountsConfirmText, bulkAccountsResultText, bulkPasswordProblem,
  studentReportsProgress, studentReportsResultText, studentReportsZipName,
} from '../services/studentBulk';

describe('who gets a login', () => {
  const rows = [
    { id: 1, has_user_account: false },
    { id: 2, has_user_account: true },
    { id: 3 },
    { id: 4, has_user_account: false },
  ];

  it('leaves out students known to have one, and only those selected', () => {
    expect(accountableIds(rows, [1, 2, 3, 4])).toEqual([1, 3, 4]);
    expect(accountableIds(rows, [2])).toEqual([]);
    expect(accountableIds(rows, [])).toEqual([]);
    expect(accountableIds(rows, [4])).toEqual([4]);
  });

  it('treats a list that does not say as eligible, so the server decides', () => {
    expect(accountableIds([{ id: 9 }], [9])).toEqual([9]);
  });
});

describe('the shared starting password', () => {
  it('needs a password of at least eight characters', () => {
    expect(bulkPasswordProblem('')).toBe('A starting password is required.');
    expect(bulkPasswordProblem('short')).toBe('Password must be at least 8 characters.');
    expect(bulkPasswordProblem('longenough')).toBeNull();
    expect(bulkPasswordProblem('12345678')).toBeNull();
  });

  it('is sent with the students in the shape the server reads', () => {
    expect(buildBulkAccountsPayload([1, 3], 'longenough')).toEqual({ student_ids: [1, 3], default_password: 'longenough' });
  });
});

describe('wording', () => {
  it('says what will happen before it does, with how many are left out', () => {
    expect(bulkAccountsConfirmText(3, 0)).toBe("3 logins will be created, each with the same starting password. Usernames are made from the students' names.");
    expect(bulkAccountsConfirmText(1, 2)).toBe("1 login will be created, each with the same starting password. Usernames are made from the students' names. 2 already have one and are left out.");
  });

  it('reports what the server did', () => {
    expect(bulkAccountsResultText({ created_count: 5, skipped_count: 0, error_count: 0 })).toBe('Created 5 logins.');
    expect(bulkAccountsResultText({ created_count: 1, skipped_count: 2, error_count: 1 })).toBe('Created 1 login. 2 already had one. 1 failed.');
    expect(bulkAccountsResultText(null)).toBe('Created 0 logins.');
  });

  it('shows the server message for a failure, or a fallback', () => {
    expect(accountsErrorText({ response: { data: { error: 'default_password must be at least 8 characters.' } } })).toBe('default_password must be at least 8 characters.');
    expect(accountsErrorText({ response: { data: { detail: 'Not allowed.' } } })).toBe('Not allowed.');
    expect(accountsErrorText(new Error('Network Error'))).toBe('Could not create the logins.');
  });
});

describe('student reports as one ZIP', () => {
  it('names the file safely', () => {
    expect(studentReportsZipName('12_students')).toBe('Student_Reports_12_students.zip');
    expect(studentReportsZipName('!!!')).toBe('Student_Reports_Students.zip');
  });

  it('reports progress and the outcome in its own words', () => {
    expect(studentReportsProgress(2, 9)).toBe('Making student reports: 2 of 9');
    expect(studentReportsResultText({ generated: 3, skipped: [], cancelled: false })).toBe('Made 3 student reports.');
    expect(studentReportsResultText({ generated: 1, skipped: [{ name: 'A', reason: 'x' }], cancelled: false })).toBe('Made 1 student report, 1 skipped.');
    expect(studentReportsResultText({ generated: 0, skipped: [], cancelled: false })).toBe('No student reports could be made.');
    expect(studentReportsResultText({ generated: 4, skipped: [], cancelled: true })).toBe('Cancelled. Nothing was shared.');
  });
});
