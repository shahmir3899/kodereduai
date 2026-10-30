// Client-side checks before change-password is sent; the server (users ChangePasswordSerializer)
// remains the authority and also applies the password validators.
export function passwordProblem(oldPassword: string, next: string, confirm: string): string | null {
  if (!oldPassword) return 'Enter your current password.';
  if (next.length < 8) return 'The new password must be at least 8 characters.';
  if (next === oldPassword) return 'Choose a password different from the current one.';
  if (next !== confirm) return 'The new passwords do not match.';
  return null;
}
