import { Link } from 'react-router-dom'

/**
 * Custom Link component that preserves subdomain param for localhost development
 * 
 * On localhost, automatically appends ?subdomain=X to all link paths
 * On production, behaves like normal Link
 * 
 * Usage: <SubdomainLink to="/dashboard">Dashboard</SubdomainLink>
 */
export default function SubdomainLink({ to, children, ...props }) {
  // Only preserve subdomain on localhost
  const hostname = window.location.hostname
  const isLocalhost = hostname === 'localhost' || hostname.startsWith('127.0.0.1')
  
  if (!isLocalhost || typeof to !== 'string') {
    // Production or non-string path - use default behavior
    return <Link to={to} {...props}>{children}</Link>
  }
  
  // Extract current subdomain param from URL or localStorage
  const params = new URLSearchParams(window.location.search)
  let subdomain = params.get('subdomain')
  
  // Validate subdomain from URL
  if (subdomain && subdomain.includes('/')) {
    subdomain = subdomain.split('/')[0]
  }
  
  // If not in URL, check localStorage (persisted by index.html)
  if (!subdomain) {
    subdomain = localStorage.getItem('dev_subdomain')
    // Validate localStorage subdomain
    if (subdomain && subdomain.includes('/')) {
      subdomain = subdomain.split('/')[0]
    }
  }
  
  if (!subdomain || subdomain === 'portal') {
    // No school subdomain - use default behavior
    return <Link to={to} {...props}>{children}</Link>
  }
  
  // Check if 'to' already has query params
  const [pathname, existingSearch] = to.split('?')
  const searchParams = new URLSearchParams(existingSearch || '')
  
  // Add subdomain if not already present
  if (!searchParams.has('subdomain')) {
    searchParams.set('subdomain', subdomain)
  }
  
  const newPath = `${pathname}?${searchParams.toString()}`
  return <Link to={newPath} {...props}>{children}</Link>
}
