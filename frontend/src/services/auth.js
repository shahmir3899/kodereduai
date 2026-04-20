import api from './api'

export const requestPasswordReset = (email) =>
  api.post('/api/auth/password-reset/', { email })

export const validatePasswordResetToken = (uid, token) =>
  api.post('/api/auth/password-reset/validate-token/', { uid, token })

export const confirmPasswordReset = (uid, token, new_password, confirm_password) =>
  api.post('/api/auth/password-reset/confirm/', { uid, token, new_password, confirm_password })
