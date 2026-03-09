import { useNavigate } from 'react-router-dom'

/**
 * Custom navigation hook that preserves subdomain param for localhost development
 * 
 * On localhost, automatically appends ?subdomain=X to all navigation paths
 * On production, behaves like normal navigate()
 * 
 * Usage: const navigate = useSubdomainNavigate()
 *        navigate('/dashboard') -> '/dashboard?subdomain=focus' (on localhost)
 */
export default function useSubdomainNavigate() {
  const routerNavigate = useNavigate()
  
  const navigate = (to, options) => {
    // Only preserve subdomain on localhost
    const hostname = window.location.hostname
    const isLocalhost = hostname === 'localhost' || hostname.startsWith('127.0.0.1')
    
    if (!isLocalhost || typeof to !== 'string') {
      // Production or non-string navigation - use default behavior
      return routerNavigate(to, options)
    }
    
    // Extract current subdomain param from URL or localStorage
    const params = new URLSearchParams(window.location.search)
    let subdomain = params.get('subdomain')
    
    // Validate subdomain from URL
    if (subdomain && subdomain.includes('/')) {
      console.warn('⚠️ Invalid subdomain in URL param, cleaning:', subdomain);
      subdomain = subdomain.split('/')[0]
    }
    
    // If not in URL, check localStorage (persisted by index.html)
    if (!subdomain) {
      subdomain = localStorage.getItem('dev_subdomain')
      // Validate localStorage subdomain too
      if (subdomain && subdomain.includes('/')) {
        console.warn('⚠️ Invalid subdomain in localStorage, cleaning:', subdomain);
        subdomain = subdomain.split('/')[0]
        localStorage.setItem('dev_subdomain', subdomain) // Fix it
      }
    }
    
    if (!subdomain || subdomain === 'portal') {
      // No school subdomain - use default behavior
      return routerNavigate(to, options)
    }
    
    // Check if 'to' already has query params
    const [pathname, existingSearch] = to.split('?')
    const searchParams = new URLSearchParams(existingSearch || '')
    
    // Add subdomain if not already present
    if (!searchParams.has('subdomain')) {
      searchParams.set('subdomain', subdomain)
    }
    
    const newPath = `${pathname}?${searchParams.toString()}`
    return routerNavigate(newPath, options)
  }
  
  return navigate
}
