import { useState, useEffect, useMemo } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import FinanceChatWidget from './FinanceChatWidget'
import AcademicsChatWidget from './AcademicsChatWidget'
import CommunicationChatWidget from './CommunicationChatWidget'
import NotificationBell from './NotificationBell'
import { TaskDrawerButton } from './TaskDrawer'
import SchoolSwitcher from './SchoolSwitcher'
import AcademicYearSwitcher from './AcademicYearSwitcher'

// Icons (simple SVG components)
const HomeIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
)

const UploadIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
)

const CameraIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const ClipboardIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </svg>
)

const ClipboardCheckIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
  </svg>
)

const UsersIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
)

const AcademicIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
  </svg>
)

const CogIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const ChartIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
)

const SettingsIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
  </svg>
)

const TableIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
  </svg>
)

const LogoutIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
  </svg>
)

const ChevronIcon = ({ className = '' }) => (
  <svg className={`w-4 h-4 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
)

const CurrencyIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

const ReceiptIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
  </svg>
)

const WalletIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
  </svg>
)

const ReportIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
)

const ChatBotIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
  </svg>
)

const BanknotesIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
  </svg>
)

const FolderIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
)

const BriefcaseIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
)

const CalendarIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
)

const StarIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
  </svg>
)

const DocumentIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
)

const BookOpenIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
  </svg>
)

const ClockIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
)

// Collapsible sidebar group component
function SidebarGroup({ group, onNavigate }) {
  const location = useLocation()
  // Sort children by href length descending so longer paths match first
  const sortedChildren = [...group.children].sort((a, b) => b.href.length - a.href.length)

  const isChildActive = (href) => {
    // Check if this child is the best (longest) match
    const matchingChild = sortedChildren.find(
      c => location.pathname === c.href || location.pathname.startsWith(c.href + '/')
    )
    return matchingChild?.href === href
  }

  const hasActiveChild = group.children.some(child => isChildActive(child.href))
  const [expanded, setExpanded] = useState(hasActiveChild)

  useEffect(() => {
    if (hasActiveChild) setExpanded(true)
  }, [hasActiveChild])

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center justify-between w-full px-4 py-2.5 rounded-lg transition-colors ${
          hasActiveChild ? 'text-primary-700 bg-primary-50/50' : 'text-gray-600 hover:bg-gray-100'
        }`}
      >
        <div className="flex items-center">
          <group.icon />
          <span className="ml-3 text-sm font-medium">{group.name}</span>
        </div>
        <ChevronIcon className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="ml-4 mt-0.5 space-y-0.5">
          {group.children.map((child) => (
            <Link
              key={child.href}
              to={child.href}
              className={`flex items-center px-4 py-2 rounded-lg transition-colors text-sm ${
                isChildActive(child.href)
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
              onClick={onNavigate}
            >
              <child.icon />
              <span className="ml-3">{child.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

const UserPlusIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
  </svg>
)

const HeartIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
)

const MailIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
)

const TagIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
  </svg>
)

const TruckIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l2 2h2m6-2h4l2 2h2a1 1 0 001-1v-5a1 1 0 00-.4-.8l-4-3a1 1 0 00-.6-.2H13m-6 4h.01M17 16h.01" />
  </svg>
)

const LibraryIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
  </svg>
)

const PencilIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
)

const MapPinIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
)

const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
)

const ExclamationIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.832c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
  </svg>
)

// Static navigation arrays (no dependencies on component state)
const parentNavGroups = [
  { type: 'item', name: 'Dashboard', href: '/parent/dashboard', icon: HomeIcon },
  { type: 'item', name: 'Leave Requests', href: '/parent/leave', icon: CalendarIcon },
  { type: 'item', name: 'Messages', href: '/parent/messages', icon: MailIcon },
]

const studentNavGroups = [
  { type: 'item', name: 'Dashboard', href: '/student/dashboard', icon: HomeIcon },
  { type: 'item', name: 'Attendance', href: '/student/attendance', icon: ClipboardIcon },
  { type: 'item', name: 'Fees', href: '/student/fees', icon: CurrencyIcon },
  { type: 'item', name: 'Timetable', href: '/student/timetable', icon: ClockIcon },
  { type: 'item', name: 'Results', href: '/student/results', icon: ChartIcon },
  { type: 'item', name: 'Assignments', href: '/student/assignments', icon: PencilIcon },
  { type: 'item', name: 'AI Study Helper', href: '/student/study-helper', icon: ChatBotIcon },
  { type: 'item', name: 'My Profile', href: '/student/profile', icon: UsersIcon },
]

// Routes where the academic year switcher affects displayed data
const SESSION_AWARE_PREFIXES = [
  '/dashboard',
  '/attendance',
  '/students',
  '/finance/fees',
  '/finance/discounts',
  '/academics/subjects',
  '/academics/exams',
  '/academics/marks-entry',
  '/academics/results',
  '/academics/report-cards',
  '/academics/lesson-plans',
  '/academics/assignments',
  '/academics/sessions',
]

export default function Layout() {
  const { user, logout, isSuperAdmin, isStaffMember, isPrincipal, isHRManager, isStaffLevel, isParent, isStudent, isModuleEnabled } = useAuth()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const isSessionAwarePage = SESSION_AWARE_PREFIXES.some(
    prefix => location.pathname === prefix || location.pathname.startsWith(prefix + '/')
  )

  const isActive = (href) => location.pathname === href || location.pathname.startsWith(href + '/')

  // Navigation structure: memoized to avoid re-creating on every render
  const navigationGroups = useMemo(() => [
    // Dashboard - always visible at top
    { type: 'item', name: 'Dashboard', href: '/dashboard', icon: HomeIcon },

    // Attendance group (consolidated)
    ...(isModuleEnabled('attendance') ? [{
      type: 'group',
      name: 'Attendance',
      icon: ClipboardIcon,
      children: [
        { name: 'Capture & Review', href: '/attendance', icon: UploadIcon },
        { name: 'Face Attendance', href: '/face-attendance', icon: CameraIcon },
        { name: 'Register & Analytics', href: '/attendance/register', icon: TableIcon },
      ],
    }] : []),

    // Finance group
    ...(isModuleEnabled('finance') ? [{
      type: 'group',
      name: 'Finance',
      icon: CurrencyIcon,
      children: [
        { name: 'Dashboard', href: '/finance', icon: ChartIcon },
        { name: 'Fee Collection', href: '/finance/fees', icon: ReceiptIcon },
        { name: 'Expenses', href: '/finance/expenses', icon: WalletIcon },
        ...(!isStaffLevel
          ? [
              { name: 'Payment Gateways', href: '/finance/payment-gateways', icon: CogIcon },
            ]
          : []),
      ],
    }] : []),

    // Academics group (includes examinations items when that module is enabled)
    ...(isModuleEnabled('academics') ? [{
      type: 'group',
      name: 'Academics',
      icon: BookOpenIcon,
      children: [
        { name: 'Subjects', href: '/academics/subjects', icon: AcademicIcon },
        { name: 'Timetable', href: '/academics/timetable', icon: ClockIcon },
        { name: 'Sessions', href: '/academics/sessions', icon: CalendarIcon },
        { name: 'Promotion', href: '/academics/promotion', icon: UsersIcon },
        ...(isModuleEnabled('examinations') ? [
          { name: 'Exam Types', href: '/academics/exam-types', icon: FolderIcon },
          { name: 'Exams', href: '/academics/exams', icon: ClipboardIcon },
          { name: 'Marks Entry', href: '/academics/marks-entry', icon: DocumentIcon },
          { name: 'Results', href: '/academics/results', icon: ChartIcon },
          { name: 'Report Cards', href: '/academics/report-cards', icon: ReportIcon },
          { name: 'Grade Scale', href: '/academics/grade-scale', icon: SettingsIcon },
        ] : []),
        { name: 'AI Analytics', href: '/academics/analytics', icon: ChartIcon },
        ...(isModuleEnabled('lms') ? [
          { name: 'Lesson Plans', href: '/academics/lesson-plans', icon: BookOpenIcon },
          { name: 'Assignments', href: '/academics/assignments', icon: PencilIcon },
        ] : []),
      ],
    }] : []),

    // HR & Staff group (visible to SCHOOL_ADMIN, PRINCIPAL, HR_MANAGER + module check)
    ...(isModuleEnabled('hr') && (!isStaffLevel || isHRManager)
      ? [{
          type: 'group',
          name: 'HR & Staff',
          icon: BriefcaseIcon,
          children: [
            { name: 'Dashboard', href: '/hr', icon: ChartIcon },
            { name: 'Staff Directory', href: '/hr/staff', icon: UsersIcon },
            { name: 'Departments', href: '/hr/departments', icon: FolderIcon },
            { name: 'Salary', href: '/hr/salary', icon: BanknotesIcon },
            { name: 'Payroll', href: '/hr/payroll', icon: ReceiptIcon },
            { name: 'Leave', href: '/hr/leave', icon: CalendarIcon },
            { name: 'Attendance', href: '/hr/attendance', icon: ClipboardCheckIcon },
            { name: 'Performance', href: '/hr/appraisals', icon: StarIcon },
            { name: 'Documents', href: '/hr/documents', icon: DocumentIcon },
          ],
        }]
      : []),

    // Management group
    ...(isModuleEnabled('students') ? [{
      type: 'group',
      name: 'Management',
      icon: FolderIcon,
      children: [
        { name: 'Classes', href: '/classes', icon: TableIcon },
        { name: 'Students', href: '/students', icon: UsersIcon },
      ],
    }] : []),

    // Notifications
    ...(isModuleEnabled('notifications') ? [{
      type: 'item', name: 'Notifications', href: '/notifications', icon: ChatBotIcon,
    }] : []),

    // Admissions (admin only)
    ...(isModuleEnabled('admissions') && !isStaffLevel ? [{
      type: 'link',
      name: 'Admissions',
      href: '/admissions',
      icon: UserPlusIcon,
    }] : []),

    // Transport group
    ...(isModuleEnabled('transport') ? [{
      type: 'group',
      name: 'Transport',
      icon: TruckIcon,
      children: [
        { name: 'Dashboard', href: '/transport', icon: ChartIcon },
        { name: 'Routes', href: '/transport/routes', icon: MapPinIcon },
        { name: 'Vehicles', href: '/transport/vehicles', icon: TruckIcon },
        { name: 'Assignments', href: '/transport/assignments', icon: UsersIcon },
        { name: 'Attendance', href: '/transport/attendance', icon: ClipboardCheckIcon },
      ],
    }] : []),

    // Library group
    ...(isModuleEnabled('library') ? [{
      type: 'group',
      name: 'Library',
      icon: LibraryIcon,
      children: [
        { name: 'Dashboard', href: '/library', icon: ChartIcon },
        { name: 'Catalog', href: '/library/catalog', icon: SearchIcon },
        { name: 'Issue / Return', href: '/library/issues', icon: BookOpenIcon },
        { name: 'Overdue', href: '/library/overdue', icon: ExclamationIcon },
      ],
    }] : []),

    // Hostel group
    ...(isModuleEnabled('hostel') ? [{
      type: 'group',
      name: 'Hostel',
      icon: HomeIcon,
      children: [
        { name: 'Dashboard', href: '/hostel', icon: ChartIcon },
        { name: 'Rooms', href: '/hostel/rooms', icon: TableIcon },
        { name: 'Allocations', href: '/hostel/allocations', icon: UsersIcon },
        { name: 'Gate Passes', href: '/hostel/gate-passes', icon: DocumentIcon },
      ],
    }] : []),

    // Inventory group
    ...(isModuleEnabled('inventory') ? [{
      type: 'group',
      name: 'Inventory',
      icon: ClipboardCheckIcon,
      children: [
        { name: 'Dashboard', href: '/inventory', icon: ChartIcon },
        { name: 'Items', href: '/inventory/items', icon: FolderIcon },
        { name: 'Transactions', href: '/inventory/transactions', icon: DocumentIcon },
        { name: 'Assignments', href: '/inventory/assignments', icon: UsersIcon },
      ],
    }] : []),

    // Finance: Discounts & Scholarships (added under Finance for admin)
    ...(isModuleEnabled('finance') && !isStaffLevel ? [{
      type: 'group',
      name: 'Discounts',
      icon: TagIcon,
      children: [
        { name: 'Discounts & Scholarships', href: '/finance/discounts', icon: TagIcon },
      ],
    }] : []),

    // Settings - admin only (SCHOOL_ADMIN, not staff-level roles)
    ...(!isStaffLevel
      ? [{ type: 'item', name: 'Settings', href: '/settings', icon: CogIcon }]
      : []),
  ], [isModuleEnabled, isStaffLevel, isHRManager])

  // SuperAdmin only sees the Admin Panel link — no school-internal nav
  const visibleNavGroups = isSuperAdmin ? [] : (isParent ? parentNavGroups : (isStudent ? studentNavGroups : navigationGroups))

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-white shadow-lg transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-center h-16 border-b border-gray-200 gap-2">
          <img src="/Logo.jpeg" alt="KoderEduAI" className="h-10 w-10 rounded-full object-cover" />
          <h1 className="text-xl font-bold text-primary-600">KoderEduAI</h1>
        </div>

        {/* Navigation */}
        <nav className="mt-4 px-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>
          {visibleNavGroups.map((item) =>
            item.type === 'group' ? (
              <SidebarGroup
                key={item.name}
                group={item}
                onNavigate={() => setSidebarOpen(false)}
              />
            ) : (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center px-4 py-2.5 mb-1 rounded-lg transition-colors text-sm ${
                  isActive(item.href)
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                onClick={() => setSidebarOpen(false)}
              >
                <item.icon />
                <span className="ml-3 font-medium">{item.name}</span>
              </Link>
            )
          )}

          {/* Admin Panel - conditional */}
          {isSuperAdmin && (
            <Link
              to="/admin"
              className={`flex items-center px-4 py-2.5 mb-1 rounded-lg transition-colors text-sm ${
                isActive('/admin')
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
              onClick={() => setSidebarOpen(false)}
            >
              <CogIcon />
              <span className="ml-3 font-medium">Admin Panel</span>
            </Link>
          )}
        </nav>

        {/* User info & logout */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200">
          <Link
            to="/profile"
            className="flex items-center mb-3 p-2 -m-2 rounded-lg hover:bg-gray-50 transition-colors"
            onClick={() => setSidebarOpen(false)}
          >
            <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
              <span className="text-primary-700 font-medium">
                {user?.username?.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">{user?.username}</p>
              <p className="text-xs text-gray-500">{user?.role_display}</p>
            </div>
          </Link>
          <button
            onClick={logout}
            className="flex items-center w-full px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogoutIcon />
            <span className="ml-3 font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-white shadow-sm">
          <div className="flex items-center justify-between h-16 px-4">
            {/* Mobile menu button */}
            <button
              className="lg:hidden p-2 rounded-lg hover:bg-gray-100"
              onClick={() => setSidebarOpen(true)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* School name / switcher + Academic Year switcher */}
            <div className="flex-1 lg:ml-0 ml-4 flex items-center gap-3">
              {isSuperAdmin ? (
                <span className="text-sm font-medium text-gray-700">Platform Admin</span>
              ) : (
                <>
                  <SchoolSwitcher />
                  <div className="hidden sm:block h-5 w-px bg-gray-200" />
                  <div className="hidden sm:block">
                    <AcademicYearSwitcher disabled={!isSessionAwarePage} />
                  </div>
                </>
              )}
            </div>

            {/* Task drawer + Notification bell + User avatar */}
            <div className="flex items-center gap-2">
              <TaskDrawerButton />
              {!isSuperAdmin && <NotificationBell />}
              <Link to="/profile" className="hidden lg:flex items-center hover:opacity-80 transition-opacity">
                <span className="text-sm text-gray-600 mr-3">{user?.username}</span>
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                  <span className="text-primary-700 font-medium text-sm">
                    {user?.username?.charAt(0).toUpperCase()}
                  </span>
                </div>
              </Link>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      {/* Floating AI Chat widgets - context-specific */}
      {location.pathname.startsWith('/finance') && !isStaffLevel && <FinanceChatWidget />}
      {location.pathname.startsWith('/academics') && <AcademicsChatWidget />}
      {location.pathname.startsWith('/notifications') && !isStaffLevel && <CommunicationChatWidget />}
    </div>
  )
}
