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

    if (id && name && subdomain) {
      setSchool({ id: parseInt(id, 10), name, subdomain, logo })
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
  children,
  footer = 'EducationAI - AI-Powered Education Platform',
}) {
  const subdomainSchool = useSubdomainSchoolBranding()

  const resolvedLogo = logo || subdomainSchool?.logo || '/Logo.jpeg'
  const resolvedTitle = title || subdomainSchool?.name || 'EducationAI'
  const resolvedSubtitle =
    subtitle ?? (subdomainSchool ? 'Sign in to access your school' : 'AI-Powered Education Platform')

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-6 sm:mb-8">
          <img
            src={resolvedLogo}
            alt={resolvedTitle}
            className="h-16 w-16 rounded-full object-cover mx-auto mb-3"
          />
          <h1 className="text-2xl sm:text-3xl font-bold text-primary-700">{resolvedTitle}</h1>
          {resolvedSubtitle && <p className="mt-2 text-gray-600">{resolvedSubtitle}</p>}
        </div>

        <div className="bg-white rounded-xl shadow-lg p-5 sm:p-8">{children}</div>

        {footer && <p className="mt-6 text-center text-sm text-gray-500">{footer}</p>}
      </div>
    </div>
  )
}
