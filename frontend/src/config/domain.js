/**
 * Single source of truth for the domains the SPA is served from.
 *
 * Hostname checks used to be hardcoded in ~10 places; a domain move meant hunting them all.
 * Keep the old domain in VITE_BASE_DOMAINS while it still redirects, then drop it.
 */
const DEFAULT_BASE_DOMAINS = 'kodereduai.pk,educationai.pk,educationai.com.pk'

export const BASE_DOMAINS = (import.meta.env.VITE_BASE_DOMAINS || DEFAULT_BASE_DOMAINS)
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean)

// Used to build outgoing links only when the current host isn't one of BASE_DOMAINS
// (e.g. localhost). On a real domain, links stay on the domain the user is already on.
export const PRIMARY_DOMAIN = (import.meta.env.VITE_PRIMARY_DOMAIN || BASE_DOMAINS[0]).trim().toLowerCase()

const currentHostname = () => (typeof window !== 'undefined' ? window.location.hostname : '')

/** The base domain this hostname belongs to (apex or any subdomain of it), else null. */
export function getBaseDomain(hostname = currentHostname()) {
  return BASE_DOMAINS.find((d) => hostname === d || hostname.endsWith(`.${d}`)) || null
}

/** True for any subdomain of a base domain (not the apex). */
export function isBaseSubdomain(hostname = currentHostname()) {
  return BASE_DOMAINS.some((d) => hostname.endsWith(`.${d}`))
}

/** portal.<base> */
export function isPortalHost(hostname = currentHostname()) {
  return BASE_DOMAINS.some((d) => hostname === `portal.${d}`)
}

/** <base> or www.<base> -- the public landing page. */
export function isStaticHost(hostname = currentHostname()) {
  return BASE_DOMAINS.some((d) => hostname === d || hostname === `www.${d}`)
}

/**
 * School subdomain for <label>.<base> hosts, else null. Exactly one label deep and not
 * `www`, so `a.b.<base>` and `www.<base>` are not treated as schools.
 */
export function getSchoolSubdomain(hostname = currentHostname()) {
  for (const d of BASE_DOMAINS) {
    if (!hostname.endsWith(`.${d}`)) continue
    const label = hostname.slice(0, -(d.length + 1))
    if (label && !label.includes('.') && label !== 'www') return label
  }
  return null
}

/** Base domain for building links: the current one, or PRIMARY_DOMAIN off-domain (dev). */
export function linkBaseDomain() {
  return getBaseDomain() || PRIMARY_DOMAIN
}

export const schoolHost = (subdomain) => `${subdomain}.${linkBaseDomain()}`
export const schoolUrl = (subdomain) => `https://${schoolHost(subdomain)}`
export const portalUrl = () => `https://portal.${linkBaseDomain()}`
export const wwwUrl = () => `https://www.${linkBaseDomain()}`
