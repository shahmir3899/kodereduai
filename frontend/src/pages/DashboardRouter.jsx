import { lazy } from 'react'
import { useAuth } from '../contexts/AuthContext'
import DashboardPage from './DashboardPage'
import AdminDashboard from './admin-dashboard/AdminDashboard'

const TeacherDashboard = lazy(() => import('./teacher/TeacherDashboard'))
const ManagerDashboard = lazy(() => import('./ManagerDashboard'))
const FinanceManagerDashboard = lazy(() => import('./FinanceManagerDashboard'))
const StaffDashboard = lazy(() => import('./staff/StaffDashboard'))
const DriverDashboard = lazy(() => import('./driver/DriverDashboard'))

export default function DashboardRouter() {
  const { effectiveRole, canManageFinance } = useAuth()

  switch (effectiveRole) {
    case 'TEACHER':
      return <TeacherDashboard />
    case 'MANAGER':
      // A Manager with the finance capability (the former Finance manager) also gets the finance tiles.
      return canManageFinance ? (
        <>
          <ManagerDashboard />
          <FinanceManagerDashboard />
        </>
      ) : <ManagerDashboard />
    case 'STAFF':
      return <StaffDashboard />
    case 'DRIVER':
      return <DriverDashboard />
    case 'SCHOOL_ADMIN':
      return <AdminDashboard />
    case 'PRINCIPAL':
      return <DashboardPage variant="principal" />
    default:
      return <DashboardPage />
  }
}
