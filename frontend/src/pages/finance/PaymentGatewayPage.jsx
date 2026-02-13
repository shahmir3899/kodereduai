import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { paymentApi } from '../../services/api'
import { useToast } from '../../components/Toast'

// ── Gateway metadata ────────────────────────────────────────────────────────

const GATEWAY_META = {
  STRIPE: {
    name: 'Stripe',
    description: 'International card payments',
    badgeColor: 'bg-purple-100 text-purple-800',
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-600',
  },
  RAZORPAY: {
    name: 'Razorpay',
    description: 'Indian payment gateway',
    badgeColor: 'bg-blue-100 text-blue-800',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
  JAZZCASH: {
    name: 'JazzCash',
    description: 'Pakistani mobile payments',
    badgeColor: 'bg-red-100 text-red-800',
    iconBg: 'bg-red-50',
    iconColor: 'text-red-600',
  },
  EASYPAISA: {
    name: 'Easypaisa',
    description: 'Pakistani mobile wallet',
    badgeColor: 'bg-green-100 text-green-800',
    iconBg: 'bg-green-50',
    iconColor: 'text-green-600',
  },
  MANUAL: {
    name: 'Manual / Offline',
    description: 'Bank transfer & cash payments',
    badgeColor: 'bg-gray-100 text-gray-800',
    iconBg: 'bg-gray-50',
    iconColor: 'text-gray-600',
  },
}

// ── Gateway-specific config field definitions ───────────────────────────────

const GATEWAY_CONFIG_FIELDS = {
  STRIPE: [
    { key: 'publishable_key', label: 'Publishable Key', type: 'text', placeholder: 'pk_live_...', required: true },
    { key: 'secret_key', label: 'Secret Key', type: 'password', placeholder: 'sk_live_...', required: true },
    { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'whsec_...', required: false },
  ],
  RAZORPAY: [
    { key: 'key_id', label: 'Key ID', type: 'text', placeholder: 'rzp_live_...', required: true },
    { key: 'key_secret', label: 'Key Secret', type: 'password', placeholder: 'Your key secret', required: true },
    { key: 'webhook_secret', label: 'Webhook Secret', type: 'password', placeholder: 'Your webhook secret', required: false },
  ],
  JAZZCASH: [
    { key: 'merchant_id', label: 'Merchant ID', type: 'text', placeholder: 'Your merchant ID', required: true },
    { key: 'password', label: 'Password', type: 'password', placeholder: 'Integration password', required: true },
    { key: 'integrity_salt', label: 'Integrity Salt', type: 'password', placeholder: 'Your integrity salt', required: true },
    { key: 'environment', label: 'Environment', type: 'select', options: ['sandbox', 'production'], required: true },
  ],
  EASYPAISA: [
    { key: 'store_id', label: 'Store ID', type: 'text', placeholder: 'Your store ID', required: true },
    { key: 'merchant_hash', label: 'Merchant Hash', type: 'password', placeholder: 'Your merchant hash', required: true },
    { key: 'environment', label: 'Environment', type: 'select', options: ['sandbox', 'production'], required: true },
  ],
  MANUAL: [
    { key: 'bank_name', label: 'Bank Name', type: 'text', placeholder: 'e.g., HBL, MCB, UBL', required: true },
    { key: 'account_title', label: 'Account Title', type: 'text', placeholder: 'Account holder name', required: true },
    { key: 'account_number', label: 'Account Number', type: 'text', placeholder: 'Bank account number', required: true },
    { key: 'iban', label: 'IBAN', type: 'text', placeholder: 'PK00XXXX0000000000000000', required: false },
    { key: 'branch', label: 'Branch', type: 'text', placeholder: 'Branch name / code', required: false },
    { key: 'instructions', label: 'Payment Instructions', type: 'textarea', placeholder: 'Instructions for parents making manual payments...', required: false },
  ],
}

const CURRENCY_OPTIONS = ['PKR', 'USD', 'INR', 'GBP', 'EUR', 'AED']

const EMPTY_FORM = {
  gateway: '',
  is_active: true,
  is_default: false,
  currency: 'PKR',
  config: {},
}

// ── SVG Icons ───────────────────────────────────────────────────────────────

function PlusIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function PencilIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  )
}

function TrashIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  )
}

function ShieldCheckIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  )
}

function CreditCardIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
    </svg>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function PaymentGatewayPage() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingGateway, setEditingGateway] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // ── Queries ─────────────────────────────────────────────────────────────

  const { data: gatewayData, isLoading } = useQuery({
    queryKey: ['gatewayConfigs'],
    queryFn: () => paymentApi.getGatewayConfigs(),
    staleTime: 5 * 60 * 1000,
  })

  const gateways = gatewayData?.data?.results || gatewayData?.data || []

  // Compute which gateway types are still available to add
  const configuredTypes = useMemo(
    () => new Set(gateways.map(g => g.gateway)),
    [gateways],
  )
  const availableTypes = useMemo(
    () => Object.keys(GATEWAY_META).filter(g => !configuredTypes.has(g)),
    [configuredTypes],
  )

  // ── Mutations ───────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data) => paymentApi.createGatewayConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gatewayConfigs'] })
      closeModal()
      showSuccess('Payment gateway configured successfully!')
    },
    onError: (err) => {
      const d = err?.response?.data
      showError(d?.detail || d?.gateway?.[0] || d?.non_field_errors?.[0] || 'Failed to create gateway configuration')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => paymentApi.updateGatewayConfig(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gatewayConfigs'] })
      closeModal()
      showSuccess('Gateway configuration updated!')
    },
    onError: (err) => {
      showError(err?.response?.data?.detail || 'Failed to update gateway configuration')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => paymentApi.deleteGatewayConfig(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gatewayConfigs'] })
      setDeleteConfirm(null)
      showSuccess('Gateway configuration deleted!')
    },
    onError: (err) => {
      showError(err?.response?.data?.detail || 'Failed to delete gateway configuration')
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }) => paymentApi.updateGatewayConfig(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gatewayConfigs'] })
      showSuccess('Gateway status updated!')
    },
    onError: (err) => {
      showError(err?.response?.data?.detail || 'Failed to toggle gateway status')
    },
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id) => paymentApi.updateGatewayConfig(id, { is_default: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gatewayConfigs'] })
      showSuccess('Default gateway updated!')
    },
    onError: (err) => {
      showError(err?.response?.data?.detail || 'Failed to set default gateway')
    },
  })

  // ── Handlers ────────────────────────────────────────────────────────────

  const openAddModal = () => {
    setEditingGateway(null)
    setForm({ ...EMPTY_FORM, gateway: availableTypes[0] || '' })
    setShowModal(true)
  }

  const openEditModal = (gw) => {
    setEditingGateway(gw)
    setForm({
      gateway: gw.gateway,
      is_active: gw.is_active,
      is_default: gw.is_default,
      currency: gw.currency || 'PKR',
      config: {},
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingGateway(null)
    setForm(EMPTY_FORM)
  }

  const updateConfigField = (key, value) => {
    setForm(prev => ({ ...prev, config: { ...prev.config, [key]: value } }))
  }

  const handleFormSubmit = (e) => {
    e.preventDefault()

    if (!form.gateway) {
      showError('Please select a gateway type')
      return
    }

    const fields = GATEWAY_CONFIG_FIELDS[form.gateway] || []

    // Validate required fields for new gateways
    if (!editingGateway) {
      for (const field of fields) {
        if (field.required && !form.config[field.key]?.trim?.()) {
          showError(`${field.label} is required`)
          return
        }
      }
    }

    const payload = {
      gateway: form.gateway,
      is_active: form.is_active,
      is_default: form.is_default,
      currency: form.currency,
    }

    // Only include config fields that have non-empty values
    const configPayload = {}
    for (const field of fields) {
      const value = form.config[field.key]
      if (value && (typeof value !== 'string' || value.trim())) {
        configPayload[field.key] = typeof value === 'string' ? value.trim() : value
      }
    }

    if (Object.keys(configPayload).length > 0 || !editingGateway) {
      payload.config = configPayload
    }

    if (editingGateway) {
      updateMutation.mutate({ id: editingGateway.id, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Payment Gateways</h1>
          <p className="text-sm text-gray-600">Configure payment gateways for online fee collection</p>
        </div>
        {availableTypes.length > 0 && (
          <button onClick={openAddModal} className="btn btn-primary flex items-center gap-1.5">
            <PlusIcon className="w-4 h-4" />
            Add Gateway
          </button>
        )}
      </div>

      {/* Security banner */}
      <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
        <ShieldCheckIcon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-blue-800">Credentials are stored securely</p>
          <p className="text-xs text-blue-600">API keys and secrets are encrypted at rest. Displayed values are masked for security.</p>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="text-gray-500 mt-2 text-sm">Loading gateway configurations...</p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && gateways.length === 0 && (
        <div className="card text-center py-12">
          <CreditCardIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Payment Gateways Configured</h3>
          <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
            Set up a payment gateway to start collecting fees online from parents.
          </p>
          <button onClick={openAddModal} className="btn btn-primary">
            Configure First Gateway
          </button>
        </div>
      )}

      {/* Gateway Cards */}
      {!isLoading && gateways.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {gateways.map((gw) => {
            const meta = GATEWAY_META[gw.gateway] || {}
            const configFields = GATEWAY_CONFIG_FIELDS[gw.gateway] || []
            const maskedConfig = gw.config || {}

            return (
              <div key={gw.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {/* Card Header */}
                <div className={`px-4 py-3 ${meta.iconBg || 'bg-gray-50'} border-b border-gray-100`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${meta.iconBg || 'bg-gray-100'}`}>
                        <CreditCardIcon className={`w-5 h-5 ${meta.iconColor || 'text-gray-600'}`} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{gw.gateway_display || meta.name}</h3>
                        <p className="text-xs text-gray-500">{meta.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {gw.is_default && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          Default
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        gw.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {gw.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Config Summary */}
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Currency</span>
                    <span className="font-medium text-gray-900">{gw.currency}</span>
                  </div>
                  {configFields.slice(0, 3).map(field => (
                    <div key={field.key} className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">{field.label}</span>
                      <span className="font-mono text-xs text-gray-600 truncate max-w-[140px]">
                        {maskedConfig[field.key] || '----'}
                      </span>
                    </div>
                  ))}
                  {configFields.length > 3 && (
                    <p className="text-xs text-gray-400">+{configFields.length - 3} more field{configFields.length - 3 > 1 ? 's' : ''} configured</p>
                  )}
                  <div className="pt-1 border-t border-gray-100">
                    <span className="text-gray-400 text-xs">
                      Updated {new Date(gw.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleActiveMutation.mutate({ id: gw.id, is_active: !gw.is_active })}
                      disabled={toggleActiveMutation.isPending}
                      className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
                        gw.is_active
                          ? 'text-red-600 hover:bg-red-50'
                          : 'text-green-600 hover:bg-green-50'
                      }`}
                    >
                      {gw.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    {!gw.is_default && gw.is_active && (
                      <button
                        onClick={() => setDefaultMutation.mutate(gw.id)}
                        disabled={setDefaultMutation.isPending}
                        className="text-xs font-medium text-yellow-600 hover:bg-yellow-50 px-2 py-1 rounded transition-colors"
                      >
                        Set Default
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(gw)}
                      className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                      title="Edit"
                    >
                      <PencilIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(gw)}
                      className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                      title="Delete"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Add / Edit Modal ──────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-1">
              {editingGateway
                ? `Edit ${GATEWAY_META[editingGateway.gateway]?.name || editingGateway.gateway}`
                : 'Add Payment Gateway'}
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {editingGateway
                ? 'Leave credential fields blank to keep existing values.'
                : 'Configure a new payment gateway for your school.'}
            </p>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* Gateway type selector (create only) */}
              {!editingGateway && (
                <div>
                  <label className="label">Gateway Type *</label>
                  <select
                    className="input"
                    value={form.gateway}
                    onChange={(e) => setForm({ ...form, gateway: e.target.value, config: {} })}
                    required
                  >
                    <option value="">-- Select Gateway --</option>
                    {availableTypes.map(g => (
                      <option key={g} value={g}>{GATEWAY_META[g]?.name || g}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Dynamic config fields */}
              {form.gateway && (
                <div className="border-t border-gray-200 pt-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    {GATEWAY_META[form.gateway]?.name} Credentials
                  </h3>
                  <div className="space-y-3">
                    {(GATEWAY_CONFIG_FIELDS[form.gateway] || []).map(field => (
                      <div key={field.key}>
                        <label className="label">
                          {field.label} {field.required && !editingGateway ? '*' : ''}
                        </label>

                        {field.type === 'textarea' ? (
                          <textarea
                            className="input"
                            rows={3}
                            value={form.config[field.key] || ''}
                            onChange={(e) => updateConfigField(field.key, e.target.value)}
                            placeholder={field.placeholder}
                          />
                        ) : field.type === 'select' ? (
                          <select
                            className="input"
                            value={form.config[field.key] || ''}
                            onChange={(e) => updateConfigField(field.key, e.target.value)}
                          >
                            <option value="">-- Select --</option>
                            {field.options.map(opt => (
                              <option key={opt} value={opt}>
                                {opt.charAt(0).toUpperCase() + opt.slice(1)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.type}
                            className="input"
                            value={form.config[field.key] || ''}
                            onChange={(e) => updateConfigField(field.key, e.target.value)}
                            placeholder={
                              editingGateway
                                ? `Current: ${editingGateway.config?.[field.key] || 'not set'}`
                                : field.placeholder
                            }
                            autoComplete="off"
                          />
                        )}

                        {editingGateway && field.type === 'password' && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            Stored: {editingGateway.config?.[field.key] || 'not set'} &mdash; leave blank to keep unchanged
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Currency & Test Connection */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Currency</label>
                  <select
                    className="input"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  >
                    {CURRENCY_OPTIONS.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-0.5">
                  <button
                    type="button"
                    className="btn btn-secondary text-xs opacity-50 cursor-not-allowed"
                    disabled
                    title="Coming soon"
                  >
                    Test Connection
                  </button>
                </div>
              </div>

              {/* Toggles */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">Set as Default</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={closeModal} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={isSaving} className="btn btn-primary">
                  {isSaving
                    ? 'Saving...'
                    : editingGateway ? 'Save Changes' : 'Configure Gateway'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation ───────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Gateway</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete the{' '}
              <strong>{GATEWAY_META[deleteConfirm.gateway]?.name || deleteConfirm.gateway}</strong>{' '}
              gateway configuration? This will remove all credentials and cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="btn btn-danger"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
