import { isStaticHost, isBaseSubdomain } from '../config/domain'

/**
 * Hook to detect and extract school information from subdomain.
 * 
 * Detects:
 * - portal.<base domain> (super admin portal)
 * - www.<base domain> or <base domain> (static/landing page)
 * - {school}.<base domain> (school-specific app)
 * Base domains come from src/config/domain.js.
 * 
 * @returns {Object} { subdomain, isSubdomain, isPortal, isStatic, hostname }
 */
export function useSubdomainSchool() {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
  const parts = hostname.split('.')
  const isLocalHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('127.') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)

  let subdomain = null
  let isSubdomain = false
  let isPortal = false
  let isStatic = false

  // Check for portal.<base domain>
  if (hostname.startsWith('portal.')) {
    isPortal = true
    subdomain = 'portal'
  }
  // Check for www.<base domain> or <base domain> (static/landing page)
  else if (isStaticHost(hostname)) {
    isStatic = true
  }
  // Check for *.<base domain> (school subdomains)
  else if (isBaseSubdomain(hostname)) {
    isSubdomain = true
    subdomain = parts[0]
  }
  // Dev / LAN: localhost, loopback, or direct IP address
  else if (isLocalHost) {
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
  const isLocalHost =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('127.') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)

  if (hostname.startsWith('portal.')) return 'portal'
  if (isStaticHost(hostname)) return 'static'
  if (isBaseSubdomain(hostname)) return 'school'
  if (isLocalHost) return 'dev'

  return 'unknown'
}
