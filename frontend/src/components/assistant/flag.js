// The assistant ships dark. It appears when the build sets VITE_ASSISTANT_ENABLED=true, or for one
// browser via localStorage (assistant_beta = "1" to force it on, "0" to force it off), so it can be
// tried on a real school without turning it on for everyone.
export function isAssistantEnabled() {
  try {
    const override = window.localStorage.getItem('assistant_beta')
    if (override === '1') return true
    if (override === '0') return false
  } catch {
    // storage blocked: fall through to the build flag
  }
  return import.meta.env.VITE_ASSISTANT_ENABLED === 'true'
}
