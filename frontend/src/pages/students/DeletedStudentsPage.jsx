import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import PageHeader from '../../components/ui/PageHeader'
import DataTable from '../../components/ui/DataTable'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Field from '../../components/ui/Field'
import Input from '../../components/ui/Input'

const formatWhen = (iso) => (iso ? new Date(iso).toLocaleString() : '—')

// The API answers 409 roll_conflict when the roll number was given to someone else
// while the student was deleted; the admin then picks a new one here.
export default function DeletedStudentsPage() {
  const queryClient = useQueryClient()
  const { showSuccess, showError } = useToast()
  const [target, setTarget] = useState(null)
  const [roll, setRoll] = useState('')
  const [conflict, setConflict] = useState('')
  const [purgeTarget, setPurgeTarget] = useState(null)
  const [typedName, setTypedName] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['deletedStudents'],
    queryFn: () => studentsApi.getDeletedStudents(),
  })
  const rows = data?.data?.results || []

  const close = () => { setTarget(null); setRoll(''); setConflict('') }
  const closePurge = () => { setPurgeTarget(null); setTypedName('') }

  // Erasing is only possible for a student who owns no records at all, so the dialog
  // asks the server first and explains why when it is not allowed.
  const { data: purgePreview, isLoading: purgeLoading } = useQuery({
    queryKey: ['removal-preview', purgeTarget?.id],
    queryFn: () => studentsApi.getRemovalPreview(purgeTarget.id),
    enabled: !!purgeTarget,
  })
  const canPurge = purgePreview?.data?.can_purge === true

  const purgeMutation = useMutation({
    mutationFn: ({ id, name }) => studentsApi.purgeStudent(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deletedStudents'] })
      showSuccess(`${purgeTarget.name} was erased permanently.`)
      closePurge()
    },
    onError: (error) => showError(error.response?.data?.detail || 'Failed to erase student'),
  })

  const restoreMutation = useMutation({
    mutationFn: ({ id, roll_number }) => studentsApi.restoreStudent(id, roll_number ? { roll_number } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deletedStudents'] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      showSuccess(`${target.name} restored.`)
      close()
    },
    onError: (error) => {
      if (error.response?.status === 409) {
        setConflict(error.response.data?.detail || 'That roll number is taken. Enter a new one.')
        return
      }
      showError(error.response?.data?.detail || 'Failed to restore student')
    },
  })

  const columns = [
    { key: 'name', header: 'Student', mobile: 'title' },
    { key: 'roll_number', header: 'Roll #' },
    { key: 'class_name', header: 'Class' },
    { key: 'deleted_at', header: 'Deleted', render: (r) => formatWhen(r.deleted_at) },
    { key: 'deleted_by', header: 'Deleted by', render: (r) => r.deleted_by || 'Unknown' },
    { key: 'deleted_reason', header: 'Reason', render: (r) => r.deleted_reason || '—' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recently deleted students"
        subtitle="Removed students are hidden, not erased. Restoring one brings back their attendance, fees, marks and enrollments."
      />
      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyTitle="No deleted students"
        emptyDescription="Students removed from the Students page will appear here."
        actions={(row) => [
          { label: 'Restore', tone: 'success', onClick: () => { setTarget(row); setRoll('') } },
          { label: 'Delete permanently', tone: 'danger', onClick: () => setPurgeTarget(row) },
        ]}
      />

      {purgeTarget && (
        <Modal
          open
          onClose={closePurge}
          title="Delete permanently"
          size="sm"
          closeOnBackdrop={false}
          footer={(
            <>
              <Button variant="secondary" onClick={closePurge}>Cancel</Button>
              <Button
                variant="danger"
                disabled={!canPurge || typedName.trim().toLowerCase() !== purgeTarget.name.trim().toLowerCase()}
                loading={purgeMutation.isPending}
                onClick={() => purgeMutation.mutate({ id: purgeTarget.id, name: typedName.trim() })}
              >
                Delete permanently
              </Button>
            </>
          )}
        >
          {purgeLoading && <p className="text-sm text-gray-500">Checking records…</p>}
          {!purgeLoading && !canPurge && (
            <p className="text-sm text-red-700">
              {purgeTarget.name} has attendance, fees, marks or other records, so they cannot be erased. They stay here
              and can be restored; if they attended, mark them as left instead.
            </p>
          )}
          {canPurge && (
            <>
              <p className="text-gray-600 dark:text-gray-300 mb-3">
                <strong>{purgeTarget.name}</strong> has no records. Erasing removes the student for good and cannot be undone.
              </p>
              <Field label={`Type "${purgeTarget.name}" to confirm`}>
                <Input value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="off" />
              </Field>
            </>
          )}
        </Modal>
      )}

      {target && (
        <Modal
          open
          onClose={close}
          title="Restore student"
          size="sm"
          footer={(
            <>
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button
                loading={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate({ id: target.id, roll_number: roll.trim() })}
              >
                Restore
              </Button>
            </>
          )}
        >
          <p className="text-gray-600 dark:text-gray-300 mb-3">
            Restore <strong>{target.name}</strong> to {target.class_name} (Roll #{target.roll_number})?
          </p>
          {conflict && <p className="text-sm text-red-600 mb-3">{conflict}</p>}
          {conflict && (
            <Field label="New roll number">
              <Input value={roll} onChange={(e) => setRoll(e.target.value)} />
            </Field>
          )}
        </Modal>
      )}
    </div>
  )
}
