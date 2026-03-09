/**
 * Hook to detect and extract school information from subdomain.
 * 
 * Detects:
 * - portal.kodereduai.pk (super admin portal)
 * - www.kodereduai.pk or kodereduai.pk (static/landing page)
 * - {school}.kodereduai.pk (school-specific app)
 * 
 * @returns {Object} { subdomain, isSubdomain, isPortal, isStatic, hostname }
 */
export function useSubdomainSchool() {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
  const parts = hostname.split('.')

  let subdomain = null
  let isSubdomain = false
  let isPortal = false
  let isStatic = false

  // Check for portal.kodereduai.pk
  if (hostname.startsWith('portal.')) {
    isPortal = true
    subdomain = 'portal'
  }
  // Check for www.kodereduai.pk or kodereduai.pk (static/landing page)
  else if (
    hostname === 'www.kodereduai.pk' ||
    hostname === 'kodereduai.pk'
  ) {
    isStatic = true
  }
  // Check for *.kodereduai.pk (school subdomains)
  else if (hostname.endsWith('.kodereduai.pk')) {
    isSubdomain = true
    subdomain = parts[0]
  }
  // Dev: localhost or 127.0.0.1
  else if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('127.0.0.1')) {
    // For dev, try to get subdomain from ?subdomain=focus query param OR localStorage
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      let devSubdomain = params.get('subdomain')
      
      // Validate subdomain - should not contain slashes
      if (devSubdomain && devSubdomain.includes('/')) {
        console.warn('⚠️ Invalid subdomain in URL (contains slash):', devSubdomain);
        devSubdomain = devSubdomain.split('/')[0]; // Take only first part
      }
      
      // Fallback to localStorage if URL param not present
      if (!devSubdomain) {
        devSubdomain = localStorage.getItem('dev_subdomain')
        // Validate localStorage value too
        if (devSubdomain && devSubdomain.includes('/')) {
          console.warn('⚠️ Invalid subdomain in localStorage (contains slash):', devSubdomain);
          devSubdomain = devSubdomain.split('/')[0];
          // Fix localStorage
          if (devSubdomain) {
            localStorage.setItem('dev_subdomain', devSubdomain)
          } else {
            localStorage.removeItem('dev_subdomain')
          }
        }
      }
      
      if (devSubdomain && devSubdomain !== 'portal') {
        isSubdomain = true
        subdomain = devSubdomain
      } else if (devSubdomain === 'portal') {
        isPortal = true
        subdomain = 'portal'
      } else {
        isStatic = true
      }
    }
  }

  return {
    subdomain,
    isSubdomain,
    isPortal,
    isStatic,
    hostname,
  }
}

/**
 * Alternative: Get subdomain from hostname during build/SSR
 * Useful for deciding which entry point to load
 */
export function detectAppType(hostname = '') {
  const parts = hostname.split('.')

  if (hostname.startsWith('portal.')) return 'portal'
  if (hostname === 'www.kodereduai.pk' || hostname === 'kodereduai.pk')
    return 'static'
  if (hostname.endsWith('.kodereduai.pk')) return 'school'
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'dev'

  return 'unknown'
}
