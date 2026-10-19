// A hard load or refresh on a deep link waits for auth/me before the router renders, and only
// then asks for the page's JS (the page chunk, then ~10-20 small dependency chunks). Measured
// on production that put ~460 ms between "who am I" returning and the page's own data request.
// Starting the same import() at boot overlaps that download with the auth call. It is only a
// download head start: App.jsx's lazy() imports the same module, so Vite serves the same chunk.
//
// Keep `file` identical to the path in App.jsx's lazy(() => import('./<file>')); a test checks it.
export const WARM_ROUTES = [
  { pattern: /^\/students\/?$/, file: 'pages/StudentsPage', load: () => import('../pages/StudentsPage') },
  { pattern: /^\/students\/[^/]+\/?$/, file: 'pages/StudentProfilePage', load: () => import('../pages/StudentProfilePage') },
  { pattern: /^\/classes\/?$/, file: 'pages/ClassesGradesPage', load: () => import('../pages/ClassesGradesPage') },
  { pattern: /^\/finance\/?$/, file: 'pages/FinanceDashboardPage', load: () => import('../pages/FinanceDashboardPage') },
  { pattern: /^\/finance\/fees\/collect\/?$/, file: 'pages/fee-collection/FeeCollectPage', load: () => import('../pages/fee-collection/FeeCollectPage') },
  { pattern: /^\/academics\/subjects\/?$/, file: 'pages/academics/SubjectsPage', load: () => import('../pages/academics/SubjectsPage') },
  { pattern: /^\/academics\/exams\/?$/, file: 'pages/examinations/ExamsPage', load: () => import('../pages/examinations/ExamsPage') },
  { pattern: /^\/academics\/results\/?$/, file: 'pages/examinations/ResultsPage', load: () => import('../pages/examinations/ResultsPage') },
  { pattern: /^\/hr\/?$/, file: 'pages/hr/HRDashboardPage', load: () => import('../pages/hr/HRDashboardPage') },
]

export function warmRouteChunk(pathname, routes = WARM_ROUTES) {
  const route = routes.find((r) => r.pattern.test(pathname || ''))
  if (!route) return false
  // A failed warm-up must never surface: the router's own lazy() import retries on render.
  Promise.resolve().then(route.load).catch(() => {})
  return true
}
