import { lazy } from 'react'
import { useAuth } from '../contexts/AuthContext'
import DashboardPage from './DashboardPage'

const TeacherDashboard = lazy(() => import('./teacher/TeacherDashboard'))
const ManagerDashboard = lazy(() => import('./ManagerDashboard'))
const AccountantDashboard = lazy(() => import('./AccountantDashboard'))
const StaffDashboard = lazy(() => import('./staff/StaffDashboard'))
const DriverDashboard = lazy(() => import('./driver/DriverDashboard'))

export default function DashboardRouter() {
  const { effectiveRole } = useAuth()

  switch (effectiveRole) {
    case 'TEACHER':
      return <TeacherDashboard />
    case 'MANAGER':
      return <ManagerDashboard />
    case 'ACCOUNTANT':
      return <AccountantDashboard />
    case 'STAFF':
      return <StaffDashboard />
    case 'DRIVER':
      return <DriverDashboard />
    case 'PRINCIPAL':
      return <DashboardPage variant="principal" />
    default:
      return <DashboardPage />
  }
}
