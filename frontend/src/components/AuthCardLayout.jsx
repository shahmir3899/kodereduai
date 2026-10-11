import { useEffect, useState } from 'react'

// Same subdomain-branding lookup LoginPage uses, so a school's logo/name follow
// the user from Sign In into Forgot/Reset Password instead of that flow dropping
// back to generic "EducationAI" branding mid-recovery.
function useSubdomainSchoolBranding() {
  const [school, setSchool] = useState(null)

  useEffect(() => {
    const isPortalMode = localStorage.getItem('isPortalMode') === 'true'
    if (isPortalMode) return

    const id = localStorage.getItem('currentSchoolId')
    const name = localStorage.getItem('currentSchoolName')
    const subdomain = localStorage.getItem('currentSchoolSubdomain')
    const logo = localStorage.getItem('currentSchoolLogo')
    const address = localStorage.getItem('currentSchoolAddress')
    const email = localStorage.getItem('currentSchoolEmail')

    if (id && name && subdomain) {
      setSchool({ id: parseInt(id, 10), name, subdomain, logo, address, email })
    }
  }, [])

  return school
}

/**
 * Shared chrome for every login / password screen (Sign In, Forgot Password,
 * Reset Password): logo, title, subtitle, and the white card that holds the
 * form. Falls back to the school's subdomain branding when the caller doesn't
 * pass its own title/logo, so Forgot/Reset Password automatically match
 * whichever school the user signed in from.
 */
export default function AuthCardLayout({
  title,
  subtitle,
  logo,
  address,
  email,
  children,
  footer = 'EducationAI - AI-Powered Education Platform',
}) {
  const subdomainSchool = useSubdomainSchoolBranding()

  const resolvedLogo = logo || subdomainSchool?.logo || '/Logo.jpeg'
  const resolvedTitle = title || subdomainSchool?.name || 'EducationAI'
  const resolvedAddress = address ?? subdomainSchool?.address
  const resolvedEmail = email ?? subdomainSchool?.email
  const resolvedSubtitle =
    subtitle ?? (subdomainSchool ? 'Sign in to access your school' : 'AI-Powered Education Platform')

  // Below md: the original centered header + card on a gradient. From md up the
  // identity moves into a brand panel on the left so a wide screen isn't a
  // narrow card floating in empty gradient.
  return (
    <div className="min-h-screen flex flex-col justify-center bg-gradient-to-br from-primary-50 to-primary-100 md:grid md:grid-cols-[1.05fr_1fr] md:bg-none md:bg-white">
      <div className="relative overflow-hidden px-4 pt-8 pb-6 text-center sm:pb-8 md:flex md:flex-col md:items-start md:justify-center md:bg-gradient-to-br md:from-primary-900 md:via-primary-800 md:to-primary-600 md:px-14 md:py-12 md:text-left">
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-32 hidden h-96 w-96 rounded-full bg-white/5 md:block" />
        <span aria-hidden="true" className="pointer-events-none absolute -left-20 -top-24 hidden h-64 w-64 rounded-full bg-white/5 md:block" />
        <div className="relative">
          <img
            src={resolvedLogo}
            alt={resolvedTitle}
            className="mx-auto mb-4 h-20 w-20 rounded-full border-2 border-blue-200 object-cover md:mx-0 md:mb-6 md:h-28 md:w-28 md:border-white/50"
            onError={(e) => {
              // A dead school-logo URL shouldn't leave a broken-image icon on the login screen.
              e.target.style.display = 'none'
            }}
          />
          <h1 className="text-2xl font-bold text-primary-700 sm:text-3xl md:max-w-md md:text-4xl md:leading-tight md:text-white">{resolvedTitle}</h1>
          {resolvedAddress && <p className="mt-2 text-sm text-gray-600 md:mt-4 md:text-base md:text-primary-100">{resolvedAddress}</p>}
          {resolvedEmail && <p className="mt-1 text-xs text-gray-500 md:text-sm md:text-primary-200">{resolvedEmail}</p>}
          {resolvedSubtitle && <p className="mt-2 text-gray-600 md:mt-8 md:text-lg md:text-primary-100">{resolvedSubtitle}</p>}
        </div>
      </div>

      <div className="flex flex-col items-center justify-center px-4 pb-8 md:px-12 md:py-12">
        <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg sm:p-8 md:rounded-none md:p-0 md:shadow-none">{children}</div>
        {footer && <p className="mt-6 text-center text-sm text-gray-500">{footer}</p>}
      </div>
    </div>
  )
}
