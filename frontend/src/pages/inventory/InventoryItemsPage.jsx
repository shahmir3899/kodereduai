import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { inventoryApi } from '../../services/api'

function formatCurrency(val) {
  return `Rs ${Number(val || 0).toLocaleString()}`
}

const UNIT_CHOICES = [
  { value: 'PCS', label: 'Pieces' },
  { value: 'PKT', label: 'Packets' },
  { value: 'BOX', label: 'Boxes' },
  { value: 'KG', label: 'Kilograms' },
  { value: 'LTR', label: 'Litres' },
  { value: 'SET', label: 'Sets' },
  { value: 'REAM', label: 'Reams' },
  { value: 'DZN', label: 'Dozens' },
  { value: 'MTR', label: 'Metres' },
]

const emptyItemForm = {
  name: '', category: '', sku: '', unit: 'PCS',
  current_stock: 0, minimum_stock: 0, unit_price: 0,
  location: '', is_active: true,
}

const emptyCategoryForm = { name: '', description: '' }
const emptyVendorForm = { name: '', contact_person: '', phone: '', email: '', address: '' }

export default function InventoryItemsPage() {
  const queryClient = useQueryClient()

  // Filters
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')

  // Modals
  const [showItemModal, setShowItemModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [itemForm, setItemForm] = useState(emptyItemForm)

  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm)
  const [editingCategory, setEditingCategory] = useState(null)

  const [showVendorModal, setShowVendorModal] = useState(false)
  const [vendorForm, setVendorForm] = useState(emptyVendorForm)
  const [editingVendor, setEditingVendor] = useState(null)

  // Active management tab
  const [manageTab, setManageTab] = useState(null) // null | 'categories' | 'vendors'

  // ---- Queries ----
  const { data: itemsData, isLoading } = useQuery({
    queryKey: ['inventoryItems', search, categoryFilter, stockFilter],
    queryFn: () => inventoryApi.getItems({
      search: search || undefined,
      category: categoryFilter || undefined,
      stock_status: stockFilter || undefined,
      page_size: 9999,
    }),
  })

  const { data: categoriesData } = useQuery({
    queryKey: ['inventoryCategories'],
    queryFn: () => inventoryApi.getCategories({ page_size: 9999 }),
  })

  const { data: vendorsData } = useQuery({
    queryKey: ['inventoryVendors'],
    queryFn: () => inventoryApi.getVendors({ page_size: 9999 }),
  })

  const items = itemsData?.data?.results || itemsData?.data || []
  const categories = categoriesData?.data?.results || categoriesData?.data || []
  const vendors = vendorsData?.data?.results || vendorsData?.data || []

  // ---- Item Mutations ----
  const saveItemMutation = useMutation({
    mutationFn: (data) => editingItem
      ? inventoryApi.updateItem(editingItem.id, data)
      : inventoryApi.createItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryItems'] })
      queryClient.invalidateQueries({ queryKey: ['inventoryDashboard'] })
      closeItemModal()
    },
  })

  const deleteItemMutation = useMutation({
    mutationFn: (id) => inventoryApi.deleteItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryItems'] })
      queryClient.invalidateQueries({ queryKey: ['inventoryDashboard'] })
    },
  })

  // ---- Category Mutations ----
  const saveCategoryMutation = useMutation({
    mutationFn: (data) => editingCategory
      ? inventoryApi.updateCategory(editingCategory.id, data)
      : inventoryApi.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryCategories'] })
      closeCategoryModal()
    },
  })

  const deleteCategoryMutation = useMutation({
    mutationFn: (id) => inventoryApi.deleteCategory(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventoryCategories'] }),
  })

  // ---- Vendor Mutations ----
  const saveVendorMutation = useMutation({
    mutationFn: (data) => editingVendor
      ? inventoryApi.updateVendor(editingVendor.id, data)
      : inventoryApi.createVendor(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventoryVendors'] })
      closeVendorModal()
    },
  })

  const deleteVendorMutation = useMutation({
    mutationFn: (id) => inventoryApi.deleteVendor(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventoryVendors'] }),
  })

  // ---- Modal Handlers ----
  const openItemModal = (item = null) => {
    if (item) {
      setEditingItem(item)
      setItemForm({
        name: item.name, category: item.category?.id || item.category || '',
        sku: item.sku || '', unit: item.unit || 'PCS',
        current_stock: item.current_stock || 0, minimum_stock: item.minimum_stock || 0,
        unit_price: item.unit_price || 0, location: item.location || '', is_active: item.is_active !== false,
      })
    } else {
      setEditingItem(null)
      setItemForm(emptyItemForm)
    }
    setShowItemModal(true)
  }
  const closeItemModal = () => { setShowItemModal(false); setEditingItem(null); setItemForm(emptyItemForm) }

  const openCategoryModal = (cat = null) => {
    if (cat) {
      setEditingCategory(cat)
      setCategoryForm({ name: cat.name, description: cat.description || '' })
    } else {
      setEditingCategory(null)
      setCategoryForm(emptyCategoryForm)
    }
    setShowCategoryModal(true)
  }
  const closeCategoryModal = () => { setShowCategoryModal(false); setEditingCategory(null); setCategoryForm(emptyCategoryForm) }

  const openVendorModal = (v = null) => {
    if (v) {
      setEditingVendor(v)
      setVendorForm({ name: v.name, contact_person: v.contact_person || '', phone: v.phone || '', email: v.email || '', address: v.address || '' })
    } else {
      setEditingVendor(null)
      setVendorForm(emptyVendorForm)
    }
    setShowVendorModal(true)
  }
  const closeVendorModal = () => { setShowVendorModal(false); setEditingVendor(null); setVendorForm(emptyVendorForm) }

  // ---- Submit Handlers ----
  const handleItemSubmit = (e) => {
    e.preventDefault()
    saveItemMutation.mutate({
      ...itemForm,
      category: itemForm.category ? parseInt(itemForm.category) : null,
      current_stock: Number(itemForm.current_stock),
      minimum_stock: Number(itemForm.minimum_stock),
      unit_price: Number(itemForm.unit_price),
    })
  }

  const handleCategorySubmit = (e) => {
    e.preventDefault()
    saveCategoryMutation.mutate(categoryForm)
  }

  const handleVendorSubmit = (e) => {
    e.preventDefault()
    saveVendorMutation.mutate(vendorForm)
  }

  const getStockBadge = (item) => {
    if (item.current_stock <= 0) return { label: 'Out of Stock', cls: 'bg-red-100 text-red-700' }
    if (item.current_stock <= (item.minimum_stock || 0)) return { label: 'Low Stock', cls: 'bg-amber-100 text-amber-700' }
    return { label: 'In Stock', cls: 'bg-green-100 text-green-700' }
  }

  const errorMessage = (err) => {
    const d = err?.response?.data
    if (typeof d === 'string') return d
    if (d?.detail) return d.detail
    if (d?.non_field_errors) return d.non_field_errors[0]
    if (d) return Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v[0] : v}`).join(', ')
    return err?.message || 'An error occurred.'
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Inventory Items</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage items, categories & vendors</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setManageTab(manageTab === 'categories' ? null : 'categories')}
            className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              manageTab === 'categories' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Categories
          </button>
          <button
            onClick={() => setManageTab(manageTab === 'vendors' ? null : 'vendors')}
            className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              manageTab === 'vendors' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Vendors
          </button>
          <button
            onClick={() => openItemModal()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            + Add Item
          </button>
        </div>
      </div>

      {/* Categories / Vendors Panel */}
      {manageTab && (
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {manageTab === 'categories' ? 'Categories' : 'Vendors'}
            </h2>
            <button
              onClick={() => manageTab === 'categories' ? openCategoryModal() : openVendorModal()}
              className="px-3 py-1.5 text-sm font-medium text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50"
            >
              + Add {manageTab === 'categories' ? 'Category' : 'Vendor'}
            </button>
          </div>
          <div className="p-5">
            {manageTab === 'categories' && (
              categories.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No categories yet. Add one to get started.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categories.map((cat) => (
                    <div key={cat.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                      <div>
                        <p className="font-medium text-sm text-gray-900">{cat.name}</p>
                        {cat.description && <p className="text-xs text-gray-500">{cat.description}</p>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openCategoryModal(cat)} className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
                        <button
                          onClick={() => { if (confirm('Delete this category?')) deleteCategoryMutation.mutate(cat.id) }}
                          className="text-xs text-red-600 hover:text-red-800"
                        >Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
            {manageTab === 'vendors' && (
              vendors.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No vendors yet. Add one to get started.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {vendors.map((v) => (
                    <div key={v.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                      <div>
                        <p className="font-medium text-sm text-gray-900">{v.name}</p>
                        <p className="text-xs text-gray-500">{[v.contact_person, v.phone].filter(Boolean).join(' | ') || 'No contact info'}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openVendorModal(v)} className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
                        <button
                          onClick={() => { if (confirm('Delete this vendor?')) deleteVendorMutation.mutate(v.id) }}
                          className="text-xs text-red-600 hover:text-red-800"
                        >Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Search</label>
            <input
              type="text"
              placeholder="Search items..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Category</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Stock Status</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="low">Low Stock</option>
              <option value="out">Out of Stock</option>
              <option value="ok">In Stock</option>
            </select>
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div className="bg-white rounded-lg shadow-sm">
        {isLoading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-3">Loading items...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <p className="text-gray-500 font-medium">No items found</p>
            <p className="text-gray-400 text-sm mt-1">Add your first inventory item to get started.</p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden divide-y divide-gray-200">
              {items.map((item) => {
                const badge = getStockBadge(item)
                return (
                  <div key={item.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-gray-900 truncate">{item.name}</p>
                        <p className="text-xs text-gray-500">{item.category_name || item.category?.name || 'Uncategorized'}</p>
                      </div>
                      <span className={`flex-shrink-0 ml-2 px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p>Stock: {item.current_stock} {item.unit} | Min: {item.minimum_stock}</p>
                      <p>Price: {formatCurrency(item.unit_price)} | Value: {formatCurrency(item.current_stock * item.unit_price)}</p>
                      {item.location && <p>Location: {item.location}</p>}
                    </div>
                    <div className="mt-2 pt-2 border-t border-gray-100 flex gap-3">
                      <button onClick={() => openItemModal(item)} className="text-xs text-blue-600 font-medium">Edit</button>
                      <button
                        onClick={() => { if (confirm(`Delete "${item.name}"?`)) deleteItemMutation.mutate(item.id) }}
                        className="text-xs text-red-600 font-medium"
                      >Delete</button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Stock</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Value</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {items.map((item) => {
                    const badge = getStockBadge(item)
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900">{item.name}</p>
                          {item.location && <p className="text-xs text-gray-400">{item.location}</p>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{item.category_name || item.category?.name || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 font-mono">{item.sku || '-'}</td>
                        <td className="px-4 py-3 text-sm text-right font-medium">
                          {item.current_stock} {item.unit}
                          <span className="text-xs text-gray-400 block">Min: {item.minimum_stock}</span>
                        </td>
                        <td className="px-4 py-3 text-sm text-right text-gray-600">{formatCurrency(item.unit_price)}</td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">{formatCurrency(item.current_stock * item.unit_price)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => openItemModal(item)} className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3">Edit</button>
                          <button
                            onClick={() => { if (confirm(`Delete "${item.name}"?`)) deleteItemMutation.mutate(item.id) }}
                            className="text-sm text-red-600 hover:text-red-800 font-medium"
                          >Delete</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ============ Item Modal ============ */}
      {showItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingItem ? 'Edit Item' : 'Add Item'}
            </h2>

            {saveItemMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errorMessage(saveItemMutation.error)}
              </div>
            )}

            <form onSubmit={handleItemSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Name *</label>
                <input type="text" required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Category</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })}>
                    <option value="">-- None --</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">SKU</label>
                  <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={itemForm.sku} onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Unit</label>
                  <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })}>
                    {UNIT_CHOICES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Current Stock</label>
                  <input type="number" min="0" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={itemForm.current_stock} onChange={(e) => setItemForm({ ...itemForm, current_stock: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Min Stock</label>
                  <input type="number" min="0" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={itemForm.minimum_stock} onChange={(e) => setItemForm({ ...itemForm, minimum_stock: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Unit Price (Rs)</label>
                  <input type="number" min="0" step="0.01" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={itemForm.unit_price} onChange={(e) => setItemForm({ ...itemForm, unit_price: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Storage Location</label>
                  <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. Store Room A"
                    value={itemForm.location} onChange={(e) => setItemForm({ ...itemForm, location: e.target.value })} />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={closeItemModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saveItemMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {saveItemMutation.isPending ? 'Saving...' : (editingItem ? 'Update' : 'Create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Category Modal ============ */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingCategory ? 'Edit Category' : 'Add Category'}
            </h2>
            {saveCategoryMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errorMessage(saveCategoryMutation.error)}
              </div>
            )}
            <form onSubmit={handleCategorySubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Name *</label>
                <input type="text" required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Description</label>
                <textarea rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={closeCategoryModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saveCategoryMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {saveCategoryMutation.isPending ? 'Saving...' : (editingCategory ? 'Update' : 'Create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Vendor Modal ============ */}
      {showVendorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingVendor ? 'Edit Vendor' : 'Add Vendor'}
            </h2>
            {saveVendorMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {errorMessage(saveVendorMutation.error)}
              </div>
            )}
            <form onSubmit={handleVendorSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Name *</label>
                <input type="text" required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Contact Person</label>
                  <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={vendorForm.contact_person} onChange={(e) => setVendorForm({ ...vendorForm, contact_person: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Phone</label>
                  <input type="text" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={vendorForm.phone} onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Email</label>
                <input type="email" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={vendorForm.email} onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Address</label>
                <textarea rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={vendorForm.address} onChange={(e) => setVendorForm({ ...vendorForm, address: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button type="button" onClick={closeVendorModal} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saveVendorMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                  {saveVendorMutation.isPending ? 'Saving...' : (editingVendor ? 'Update' : 'Create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
