import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'

/**
 * Modal for managing monthly fee categories (add / rename / delete).
 * Mirrors CategoryManagerModal but uses the monthly-categories API.
 */
export default function MonthlyCategoryManagerModal({ onClose }) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()

  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  const { data: catData, isLoading } = useQuery({
    queryKey: ['monthly-categories'],
    queryFn: () => financeApi.getMonthlyCategories(),
  })

  const { data: suggData } = useQuery({
    queryKey: ['monthly-category-suggestions'],
    queryFn: () => financeApi.getMonthlyCategorySuggestions(),
  })

  const categories = catData?.data?.results ?? catData?.data ?? []
  const suggestions = suggData?.data?.suggestions ?? []

  const createMutation = useMutation({
    mutationFn: (data) => financeApi.createMonthlyCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['monthly-categories'])
      queryClient.invalidateQueries(['monthly-category-suggestions'])
      setNewName('')
      setNewDesc('')
      addToast('Category created', 'success')
    },
    onError: (err) => addToast(getErrorMessage(err, 'Failed to create category'), 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => financeApi.updateMonthlyCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['monthly-categories'])
      setEditingId(null)
      addToast('Category updated', 'success')
    },
    onError: (err) => addToast(getErrorMessage(err, 'Failed to update category'), 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => financeApi.deleteMonthlyCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['monthly-categories'])
      queryClient.invalidateQueries(['monthly-category-suggestions'])
      setDeleteConfirmId(null)
      addToast('Category deleted', 'success')
    },
    onError: (err) => addToast(getErrorMessage(err, 'Failed to delete category'), 'error'),
  })

  function handleCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    createMutation.mutate({ name: newName.trim(), description: newDesc.trim() })
  }

  function handleAddSuggestion(suggestion) {
    createMutation.mutate({ name: suggestion.name, description: suggestion.description })
  }

  function startEdit(cat) {
    setEditingId(cat.id)
    setEditName(cat.name)
    setEditDesc(cat.description || '')
  }

  function handleUpdate(e) {
    e.preventDefault()
    if (!editName.trim()) return
    updateMutation.mutate({ id: editingId, data: { name: editName.trim(), description: editDesc.trim() } })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">Manage Monthly Charge Categories</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {/* Existing categories */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Your Categories</h3>
            {isLoading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : categories.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No categories yet. Add one below or pick a suggestion.</p>
            ) : (
              <ul className="space-y-2">
                {categories.map((cat) => (
                  <li key={cat.id} className="flex items-center gap-2">
                    {editingId === cat.id ? (
                      <form onSubmit={handleUpdate} className="flex-1 flex gap-2">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="input-field flex-1 text-sm"
                          required
                          autoFocus
                        />
                        <input
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="input-field flex-1 text-sm"
                          placeholder="Description (optional)"
                        />
                        <button type="submit" disabled={updateMutation.isPending}
                          className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50">
                          Save
                        </button>
                        <button type="button" onClick={() => setEditingId(null)}
                          className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300">
                          Cancel
                        </button>
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
                          {cat.description && <span className="text-xs text-gray-500 ml-2">{cat.description}</span>}
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
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Add Custom Category</h3>
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="input-field flex-1 text-sm"
                placeholder="Category name (e.g. Transport)"
                required
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="input-field flex-1 text-sm"
                placeholder="Description (optional)"
              />
              <button type="submit" disabled={createMutation.isPending || !newName.trim()}
                className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 disabled:opacity-50 whitespace-nowrap">
                {createMutation.isPending ? 'Adding…' : '+ Add'}
              </button>
            </form>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Suggestions</h3>
              <p className="text-xs text-gray-500 mb-2">Click to add as a category for your school.</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={`suggestion-${s.name}`}
                    onClick={() => handleAddSuggestion(s)}
                    disabled={createMutation.isPending}
                    className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs rounded-full hover:bg-blue-100 disabled:opacity-50"
                    title={s.description}
                  >
                    + {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
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
