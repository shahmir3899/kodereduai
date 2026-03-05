import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../../services/api'

/**
 * Static/Landing Page
 * 
 * Shown at www.kodereduai.pk and kodereduai.pk
 * Includes school discovery, signup, and admin login links
 */
export default function StaticSite() {
  const navigate = useNavigate()

  // Fetch public list of schools
  const { data: schools = [] } = useQuery({
    queryKey: ['public-schools'],
    queryFn: async () => {
      const response = await api.get('/api/schools/?page_size=100&is_active=true')
      return response.data.results || []
    },
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-blue-600">KoderEduAI</h1>
          <div className="space-x-4">
            <a
              href="https://portal.kodereduai.pk"
              className="text-gray-700 hover:text-blue-600 font-medium"
            >
              Admin Portal
            </a>
            <button
              onClick={() => navigate('/login')}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Login
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-6">
          AI-Powered School Management
        </h2>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
          Streamline attendance, manage finances, and empower your school with
          intelligent automation.
        </p>
        <button
          onClick={() => navigate('/register')}
          className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 text-lg font-medium"
        >
          Get Started
        </button>
      </section>

      {/* Schools Directory */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h3 className="text-2xl font-bold text-gray-900 mb-12 text-center">
          Our Partner Schools
        </h3>

        {schools.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {schools.map((school) => (
              <div
                key={school.id}
                className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-6 cursor-pointer"
                onClick={() => {
                  window.location.href = `https://${school.subdomain}.kodereduai.pk`
                }}
              >
                {school.logo && (
                  <img
                    src={school.logo}
                    alt={school.name}
                    className="h-12 mb-4"
                    onError={(e) => {
                      e.target.style.display = 'none'
                    }}
                  />
                )}
                <h4 className="text-lg font-semibold text-gray-900 mb-2">
                  {school.name}
                </h4>
                {school.address && (
                  <p className="text-sm text-gray-600 mb-4">{school.address}</p>
                )}
                <div className="pt-4 border-t border-gray-200">
                  <a
                    href={`https://${school.subdomain}.kodereduai.pk`}
                    className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                  >
                    Login →
                  </a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-600">
            <p className="text-lg">No schools found</p>
          </div>
        )}
      </section>

      {/* Features Section */}
      <section className="bg-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h3 className="text-2xl font-bold text-gray-900 mb-12 text-center">
            Key Features
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                title: 'AI Attendance',
                description:
                  'Automated attendance from handwritten registers using OCR and LLM.',
              },
              {
                title: 'Finance Management',
                description:
                  'Complete fee collection, expense tracking, and financial reporting.',
              },
              {
                title: 'Multi-Tenant',
                description:
                  'Serve unlimited schools with complete data isolation and customization.',
              },
            ].map((feature, idx) => (
              <div key={idx} className="text-center">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-lg mx-auto mb-4 flex items-center justify-center text-xl font-bold">
                  {idx + 1}
                </div>
                <h4 className="text-lg font-semibold text-gray-900 mb-2">
                  {feature.title}
                </h4>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p>&copy; 2026 KoderEduAI. All rights reserved.</p>
          <p className="text-gray-400 text-sm mt-2">
            Empowering schools with intelligent technology
          </p>
        </div>
      </footer>
    </div>
  )
}
