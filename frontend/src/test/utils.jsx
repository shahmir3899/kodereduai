import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

// Minimal AuthContext mock
import { createContext, useContext } from 'react'

const AuthContext = createContext(null)

function MockAuthProvider({ children, user }) {
  const value = {
    user: user || {
      id: 1, username: 'admin', role: 'SCHOOL_ADMIN',
      schools: [{ id: 1, name: 'Test School', role: 'SCHOOL_ADMIN', is_default: true }],
    },
    activeSchool: { id: 1, name: 'Test School', role: 'SCHOOL_ADMIN', is_default: true },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    switchSchool: vi.fn(),
    isModuleEnabled: () => true,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(ui, { route = '/', user, queryClient } = {}) {
  const testQueryClient = queryClient || createTestQueryClient()
  function Wrapper({ children }) {
    return (
      <QueryClientProvider client={testQueryClient}>
        <MemoryRouter initialEntries={[route]}>
          <MockAuthProvider user={user}>
            {children}
          </MockAuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  return {
    ...render(ui, { wrapper: Wrapper }),
    queryClient: testQueryClient,
  }
}
