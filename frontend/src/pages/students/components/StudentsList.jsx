import { Link } from 'react-router-dom'
import Badge from '../../../components/ui/Badge'
import { SkeletonTable } from '../../../components/ui/Skeleton'
import WhatsAppTick from '../../../components/WhatsAppTick'
import { RecordCard, CardGrid, ViewToggle } from '../../../components/cards'
import { getLifecycleLabel, getLifecycleStyle } from '../../../utils/studentLifecycle'
import StudentAvatar from './StudentAvatar'

const TH = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase'

// Results card: count + card/table toggle, then skeleton, empty state, cards or table.
export default function StudentsList({
  isLoading,
  students,
  totalCount,
  isFiltered,
  view,
  onViewChange,
  selectedIds,
  allSelectableSelected,
  onToggleSelect,
  onToggleSelectAll,
  canManageLifecycle,
  onEdit,
  onConvert,
  onDelete,
}) {
  return (
    <div className="card">
      {!isLoading && totalCount > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-sm text-gray-500">
            Showing {students.length} of {totalCount} students
            {isFiltered && ' (filtered)'}
          </div>
          <ViewToggle view={view} onChange={onViewChange} />
        </div>
      )}

      {isLoading ? (
        <div className="hidden sm:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-10"></th>
                <th className={TH}>Roll No</th>
                <th className={TH}>Name</th>
                <th className={TH}>Class</th>
                <th className={TH}>Parent Phone</th>
                <th className={TH}>Account</th>
                <th className={TH}>Lifecycle</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <SkeletonTable rows={6} cols={8} />
          </table>
        </div>
      ) : students.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          {totalCount === 0
            ? 'No students found. Add students individually or upload an Excel file.'
            : 'No students match your filter. Try adjusting the class or search criteria.'}
        </div>
      ) : view === 'cards' ? (
        <CardGrid>
          {students.map((student) => (
            <RecordCard
              key={student.id}
              highlighted={selectedIds.has(student.id)}
              leading={
                <div className="flex items-center gap-2">
                  {!student.has_user_account && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(student.id)}
                      onChange={() => onToggleSelect(student.id)}
                      className="rounded flex-shrink-0"
                    />
                  )}
                  <StudentAvatar student={student} sizeClass="w-9 h-9" />
                </div>
              }
              title={student.name}
              meta={`Roll #${student.roll_number} · ${student.class_name}`}
              status={
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${getLifecycleStyle(student.status)}`}>
                  {getLifecycleLabel(student.status)}
                </span>
              }
              fields={[
                {
                  label: 'Parent phone',
                  value: student.parent_phone
                    ? <span className="inline-flex items-center">{student.parent_phone}<WhatsAppTick phone={student.parent_phone} /></span>
                    : <span className="text-gray-400 italic">Not set</span>,
                },
                {
                  label: 'Account',
                  value: student.has_user_account
                    ? <Badge tone="success" title={student.user_username}>{student.user_username || 'User'}</Badge>
                    : <span className="text-gray-400">No account</span>,
                },
              ]}
              actions={[
                { label: 'View', to: `/students/${student.id}` },
                { label: 'Edit', tone: 'info', onClick: () => onEdit(student) },
                ...(!student.has_user_account ? [{ label: 'Create Account', tone: 'accent', onClick: () => onConvert(student) }] : []),
                ...(canManageLifecycle ? [{ label: 'Delete', tone: 'danger', onClick: () => onDelete(student) }] : []),
              ]}
            />
          ))}
        </CardGrid>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-10">
                  <input
                    type="checkbox"
                    checked={allSelectableSelected}
                    onChange={onToggleSelectAll}
                    className="rounded"
                    title="Select all students without accounts"
                  />
                </th>
                <th className={TH}>Roll No</th>
                <th className={TH}>Name</th>
                <th className={TH}>Class</th>
                <th className={TH}>Parent Phone</th>
                <th className={TH}>Account</th>
                <th className={TH}>Lifecycle</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {students.map((student) => (
                <tr key={student.id} className={`hover:bg-gray-50 ${selectedIds.has(student.id) ? 'bg-purple-50' : ''}`}>
                  <td className="px-3 py-3">
                    {!student.has_user_account ? (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(student.id)}
                        onChange={() => onToggleSelect(student.id)}
                        className="rounded"
                      />
                    ) : <span className="w-4 h-4 block" />}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">{student.roll_number}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      <StudentAvatar student={student} sizeClass="w-7 h-7" />
                      {student.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{student.class_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {student.parent_phone ? <>{student.parent_phone}<WhatsAppTick phone={student.parent_phone} /></> : <span className="text-gray-400 italic">Not set</span>}
                  </td>
                  <td className="px-4 py-3">
                    {student.has_user_account ? (
                      <Badge tone="success" title={student.user_username}>
                        {student.user_username || 'User'}
                      </Badge>
                    ) : (
                      <span className="text-xs text-gray-400">No Account</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getLifecycleStyle(student.status)}`}>
                      {getLifecycleLabel(student.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link
                      to={`/students/${student.id}`}
                      className="text-sm text-primary-600 hover:text-primary-800 font-medium mr-3"
                    >
                      View
                    </Link>
                    <button
                      onClick={() => onEdit(student)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                    >
                      Edit
                    </button>
                    {!student.has_user_account && (
                      <button
                        onClick={() => onConvert(student)}
                        className="text-sm text-purple-600 hover:text-purple-800 font-medium mr-3"
                      >
                        Create Account
                      </button>
                    )}
                    {canManageLifecycle && (
                      <button
                        onClick={() => onDelete(student)}
                        className="text-sm text-red-600 hover:text-red-800 font-medium"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
