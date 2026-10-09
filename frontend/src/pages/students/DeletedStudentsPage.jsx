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

  const { data, isLoading } = useQuery({
    queryKey: ['deletedStudents'],
    queryFn: () => studentsApi.getDeletedStudents(),
  })
  const rows = data?.data?.results || []

  const close = () => { setTarget(null); setRoll(''); setConflict('') }

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
        actions={(row) => [{ label: 'Restore', tone: 'success', onClick: () => { setTarget(row); setRoll('') } }]}
      />

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
