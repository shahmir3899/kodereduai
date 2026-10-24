import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Field from '../../components/ui/Field'
import LoadingState from '../../components/ui/LoadingState'
import { libraryApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'

const FIELDS = [
  { key: 'loan_period_days', label: 'Loan Period (days)', hint: 'Default due date when issuing a book', min: 1, step: 1 },
  { key: 'max_books_student', label: 'Max Books per Student', hint: 'Books a student can hold at once', min: 1, step: 1 },
  { key: 'max_books_staff', label: 'Max Books per Staff Member', hint: 'Books a staff member can hold at once', min: 1, step: 1 },
  { key: 'fine_per_day', label: 'Fine per Overdue Day (Rs.)', hint: 'Charged when an overdue book is returned', min: 0, step: '0.01' },
]

// Admin-only: the config endpoint refuses every other role.
export default function LibrarySettingsModal({ onClose }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState(null)

  const { data, isLoading } = useQuery({
    queryKey: ['libraryConfig'],
    queryFn: () => libraryApi.getFineConfig(),
  })

  useEffect(() => {
    if (data?.data) {
      const c = data.data
      setForm({
        loan_period_days: c.loan_period_days,
        max_books_student: c.max_books_student,
        max_books_staff: c.max_books_staff,
        fine_per_day: c.fine_per_day,
      })
    }
  }, [data])

  const save = useMutation({
    mutationFn: (payload) => libraryApi.updateFineConfig(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryConfig'] })
      toast.showSuccess('Library settings saved')
      onClose()
    },
    onError: (err) => toast.showError(getErrorMessage(err, 'Failed to save the settings.')),
  })

  const submit = (e) => {
    e.preventDefault()
    save.mutate(form)
  }

  return (
    <Modal open onClose={onClose} title="Library Settings" size="md" closeOnBackdrop={false}>
      {isLoading || !form ? (
        <LoadingState label="Loading settings..." compact />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint} required>
              <input
                type="number"
                required
                min={f.min}
                step={f.step}
                className="input"
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </Field>
          ))}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <Button variant="secondary" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>Save Settings</Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
