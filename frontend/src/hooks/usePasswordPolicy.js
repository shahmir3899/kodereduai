// Single source of truth for the password rule every create/reset/change-password
// form in the app enforces client-side. Previously each of ~9 forms hardcoded its
// own `password.length < 8` / `password !== confirm_password` checks with slightly
// different copy — easy to add a tenth form (or a Super Admin one) that quietly
// skips the check. Server-side validation is unaffected; this only mirrors it
// client-side for immediate feedback.
export const PASSWORD_MIN_LENGTH = 8

export function usePasswordPolicy() {
  const validateLength = (password) =>
    password.length < PASSWORD_MIN_LENGTH
      ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
      : null

  const validateMatch = (password, confirmPassword) =>
    password !== confirmPassword ? "Passwords don't match." : null

  // Runs both checks in the order most forms already used (match, then length)
  // and returns the first failure, or null when the password is valid.
  const validate = (password, confirmPassword) =>
    validateMatch(password, confirmPassword) || validateLength(password)

  return { minLength: PASSWORD_MIN_LENGTH, validate, validateLength, validateMatch }
}
