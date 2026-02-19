import { lazy } from 'react'
import { useAuth } from '../contexts/AuthContext'
import DashboardPage from './DashboardPage'

const TeacherDashboard = lazy(() => import('./teacher/TeacherDashboard'))
const HRManagerDashboard = lazy(() => import('./HRManagerDashboard'))
const AccountantDashboard = lazy(() => import('./AccountantDashboard'))
const StaffDashboard = lazy(() => import('./staff/StaffDashboard'))

export default function DashboardRouter() {
  const { effectiveRole } = useAuth()

  switch (effectiveRole) {
    case 'TEACHER':
      return <TeacherDashboard />
    case 'HR_MANAGER':
      return <HRManagerDashboard />
    case 'ACCOUNTANT':
      return <AccountantDashboard />
    case 'STAFF':
      return <StaffDashboard />
    case 'PRINCIPAL':
      return <DashboardPage variant="principal" />
    default:
      return <DashboardPage />
  }
}
