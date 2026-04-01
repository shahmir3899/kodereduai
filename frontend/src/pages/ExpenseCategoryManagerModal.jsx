import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../services/api'
import { useToast } from '../components/Toast'
import { getErrorMessage } from '../utils/errorUtils'

/**
 * Modal for managing expense categories (add / rename / delete).
 * Mirrors MonthlyCategoryManagerModal pattern but for expense categories.
 */
export default function ExpenseCategoryManagerModal({ onClose }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const [newName, setNewName] = useState('')
  const [newSensitive, setNewSensitive] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editSensitive, setEditSensitive] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  const { data: catData, isLoading } = useQuery({
    queryKey: ['expenseCategories'],
    queryFn: () => financeApi.getExpenseCategories({ page_size: 9999 }),
  })

  const categories = catData?.data?.results ?? catData?.data ?? []

  // Check if API returned is_sensitive field (only admins see it)
  const canManageSensitive = categories.length > 0 ? 'is_sensitive' in categories[0] : true

  const createMutation = useMutation({
    mutationFn: (data) => financeApi.createExpenseCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenseCategories'] })
      setNewName('')
      setNewSensitive(false)
      showToast('Category created', 'success')
    },
    onError: (err) => showToast(getErrorMessage(err, 'Failed to create category'), 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => financeApi.updateExpenseCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenseCategories'] })
      setEditingId(null)
      showToast('Category updated', 'success')
    },
    onError: (err) => showToast(getErrorMessage(err, 'Failed to update category'), 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => financeApi.deleteExpenseCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenseCategories'] })
      queryClient.invalidateQueries({ queryKey: ['expenseCategorySummary'] })
      setDeleteConfirmId(null)
      showToast('Category deleted', 'success')
    },
    onError: (err) => showToast(getErrorMessage(err, 'Failed to delete category'), 'error'),
  })

  function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    const data = { name: newName.trim() }
    if (canManageSensitive) data.is_sensitive = newSensitive
    createMutation.mutate(data)
  }

  function startEdit(cat) {
    setEditingId(cat.id)
    setEditName(cat.name)
    setEditSensitive(cat.is_sensitive || false)
  }

  function handleUpdate(e) {
    e.preventDefault()
    if (!editName.trim()) return
    const data = { name: editName.trim() }
    if (canManageSensitive) data.is_sensitive = editSensitive
    updateMutation.mutate({ id: editingId, data })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">Manage Expense Categories</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {/* Existing categories */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Your Categories</h3>
            {isLoading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : categories.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No categories yet. Add one below.</p>
            ) : (
              <ul className="space-y-2">
                {categories.map((cat) => (
                  <li key={cat.id} className="flex items-center gap-2">
                    {editingId === cat.id ? (
                      <form onSubmit={handleUpdate} className="flex-1 space-y-2">
                        <div className="flex gap-2">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="input-field flex-1 text-sm"
                            required
                            autoFocus
                          />
                          <button type="submit" disabled={updateMutation.isPending}
                            className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50">
                            Save
                          </button>
                          <button type="button" onClick={() => setEditingId(null)}
                            className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300">
                            Cancel
                          </button>
                        </div>
                        {canManageSensitive && (
                          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                            <input type="checkbox" checked={editSensitive} onChange={(e) => setEditSensitive(e.target.checked)} className="rounded" />
                            Sensitive (hidden from staff)
                          </label>
                        )}
                      </form>
                    ) : deleteConfirmId === cat.id ? (
                      <div className="flex-1 flex items-center gap-2 bg-red-50 border border-red-200 rounded px-3 py-2">
                        <span className="text-sm text-red-800 flex-1">Delete <strong>{cat.name}</strong>?</span>
                        <button onClick={() => deleteMutation.mutate(cat.id)} disabled={deleteMutation.isPending}
                          className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50">
                          Delete
                        </button>
                        <button onClick={() => setDeleteConfirmId(null)}
                          className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800">{cat.name}</span>
                          {cat.is_sensitive && <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 rounded">Sensitive</span>}
                        </div>
                        <button onClick={() => startEdit(cat)}
                          className="text-xs text-blue-600 hover:underline">Edit</button>
                        <button onClick={() => setDeleteConfirmId(cat.id)}
                          className="text-xs text-red-500 hover:underline">Delete</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Add new category */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Add Category</h3>
            <form onSubmit={handleCreate} className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="input-field flex-1 text-sm"
                  placeholder="Category name (e.g. Utilities)"
                  required
                />
                <button type="submit" disabled={createMutation.isPending || !newName.trim()}
                  className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50 whitespace-nowrap">
                  {createMutation.isPending ? 'Adding…' : '+ Add'}
                </button>
              </div>
              {canManageSensitive && (
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={newSensitive} onChange={(e) => setNewSensitive(e.target.checked)} className="rounded" />
                  Mark as sensitive (hidden from staff members)
                </label>
              )}
            </form>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
