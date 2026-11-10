import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../../components/Toast'
import { faceAttendanceApi } from '../../services/api'
import LoadingState from '../../components/ui/LoadingState'
import ClassSelector from '../../components/ClassSelector'
import { useConfirmModal } from '../../components/ConfirmModal'
import { AddDevicePanel, DeviceKeyReveal } from './AddDevicePanel'
import { getDeviceKey, saveDeviceKey } from '../../utils/deviceKeyStore'

// A device that hasn't posted a match in this long is shown as offline.
// Matches the on-prem client's SAMPLE_INTERVAL_SECONDS default (a few
// seconds) with generous headroom for a dropped connection or a slow
// reconnect before flagging it, rather than flapping on every missed frame.
const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function isDeviceOnline(lastSeenAt) {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() <= OFFLINE_THRESHOLD_MS
}

function OnlineBadge({ lastSeenAt }) {
  const online = isDeviceOnline(lastSeenAt)
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${online ? 'text-green-700' : 'text-gray-500'}`}>
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-gray-300'}`} />
      {online ? 'Online' : lastSeenAt ? `Offline — last seen ${timeAgo(lastSeenAt)}` : 'Never connected'}
    </span>
  )
}

function DeviceEditForm({ device, onCancel, onSave, saving }) {
  const [name, setName] = useState(device.name)
  const [scopeType, setScopeType] = useState(device.scope_type)
  const [classObj, setClassObj] = useState(device.class_obj ? String(device.class_obj) : '')
  const [isActive, setIsActive] = useState(device.is_active)

  const handleSave = () => {
    onSave({
      name,
      scope_type: scopeType,
      class_obj: scopeType === 'CLASS' ? (classObj ? parseInt(classObj) : null) : null,
      is_active: isActive,
    })
  }

  return (
    <div className="p-4 bg-gray-50 space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Scope</label>
        <select
          value={scopeType}
          onChange={(e) => setScopeType(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="CLASS">Single class</option>
          <option value="SCHOOL">Whole school</option>
        </select>
      </div>
      {scopeType === 'CLASS' && (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Class</label>
          <ClassSelector
            value={classObj}
            onChange={(e) => setClassObj(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active
      </label>
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !name || (scopeType === 'CLASS' && !classObj)}
          className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function FaceDevicesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [editingId, setEditingId] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [revealed, setRevealed] = useState(null) // device + its raw api_key, kept in memory only, shown once
  const { confirm, ConfirmModalRoot } = useConfirmModal()

  const { data, isLoading } = useQuery({
    queryKey: ['faceCaptureDevices'],
    queryFn: () => faceAttendanceApi.getDevices(),
  })
  const devices = data?.data?.results || data?.data || []

  const updateMutation = useMutation({
    mutationFn: ({ id, ...changes }) => faceAttendanceApi.updateDevice(id, changes),
    onSuccess: () => {
      showSuccess('Device updated')
      setEditingId(null)
      queryClient.invalidateQueries({ queryKey: ['faceCaptureDevices'] })
    },
    onError: (err) => {
      showError(
        err.response?.data?.error
        || err.response?.data?.non_field_errors?.[0]
        || err.response?.data?.detail
        || 'Failed to update device'
      )
    },
  })

  const createMutation = useMutation({
    mutationFn: (payload) => faceAttendanceApi.createDevice(payload),
    onSuccess: (res) => {
      setShowAdd(false)
      setRevealed(res.data)
      queryClient.invalidateQueries({ queryKey: ['faceCaptureDevices'] })
      queryClient.invalidateQueries({ queryKey: ['faceStatus'] })
    },
    onError: (err) => {
      showError(
        err.response?.data?.error
        || err.response?.data?.non_field_errors?.[0]
        || err.response?.data?.name?.[0]
        || err.response?.data?.detail
        || 'Failed to add device'
      )
    },
  })

  const rotateMutation = useMutation({
    mutationFn: (id) => faceAttendanceApi.rotateDeviceKey(id),
    onSuccess: (res) => {
      setRevealed(res.data)
      queryClient.invalidateQueries({ queryKey: ['faceCaptureDevices'] })
    },
    onError: (err) => showError(err.response?.data?.error || err.response?.data?.detail || 'Failed to reset the key'),
  })

  // Run this browser as the device: keep its key on this browser only, then open the camera page.
  const startAutoCamera = (device) => {
    if (device.api_key) saveDeviceKey(device.id, device.api_key)
    navigate(`/face-attendance/auto-camera/${device.id}`)
  }

  // A listed browser device only has its key on browsers that were given it. If this
  // one wasn't, the only way to run it here is a fresh key (which retires the old one).
  const handleStartFromList = async (device) => {
    if (getDeviceKey(device.id)) {
      navigate(`/face-attendance/auto-camera/${device.id}`)
      return
    }
    const ok = await confirm({
      title: 'Set up this browser',
      message: "This browser doesn't have the device's key yet. Generate a new key for it? The old key stops working, so any other screen using it must be set up again.",
      confirmLabel: 'Generate new key',
      variant: 'warning',
    })
    if (ok) rotateMutation.mutate(device.id)
  }

  const handleResetKey = async (device) => {
    const ok = await confirm({
      title: 'Reset device key',
      message: `Generate a new key for "${device.name}"? The current key stops working immediately.`,
      confirmLabel: 'Reset key',
    })
    if (ok) rotateMutation.mutate(device.id)
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
        <button
          onClick={() => navigate('/face-attendance')}
          className="text-sm text-gray-500 hover:text-gray-700 mb-1 flex items-center gap-1"
        >
          <span>&larr;</span> Back
        </button>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Capture Devices</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cameras registered for this school. A device recognises students and marks attendance automatically.
        </p>
        </div>
        <button
          onClick={() => { setShowAdd((v) => !v); setRevealed(null) }}
          className="shrink-0 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Add Device
        </button>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        <span className="px-4 py-2 text-sm font-medium border-b-2 border-blue-500 text-blue-600 -mb-px">
          Devices
        </span>
        <Link
          to="/face-attendance/live-events"
          className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          Live Events
        </Link>
      </div>

      <div className="bg-white rounded-lg border">
        {showAdd && (
          <AddDevicePanel
            saving={createMutation.isPending}
            onCancel={() => setShowAdd(false)}
            onSubmit={(payload) => createMutation.mutate(payload)}
          />
        )}
        {revealed && (
          <DeviceKeyReveal
            device={revealed}
            onStartAutoCamera={() => startAutoCamera(revealed)}
            onDone={() => setRevealed(null)}
          />
        )}
        {isLoading ? (
          <LoadingState />
        ) : devices.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No capture devices yet. Use &ldquo;Add Device&rdquo; to set up an automatic camera.
          </div>
        ) : (
          <div className="divide-y">
            {devices.map((device) => (
              <div key={device.id}>
                <div className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-gray-900">{device.name}</div>
                    <div className="text-sm text-gray-500 mt-0.5">
                      {device.scope_type === 'CLASS'
                        ? (device.class_obj_detail?.name || 'Class (unknown)')
                        : 'Whole school'}
                      {' · '}{device.embedding_version}
                      {!device.is_active && <span className="ml-2 text-red-600 font-medium">Inactive</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <OnlineBadge lastSeenAt={device.last_seen_at} />
                    {device.embedding_version === 'faceapi_v1' && device.is_active && (
                      <button
                        onClick={() => handleStartFromList(device)}
                        className="text-sm text-green-700 hover:text-green-900 font-medium"
                      >
                        Start auto camera
                      </button>
                    )}
                    <button
                      onClick={() => handleResetKey(device)}
                      className="text-sm text-gray-500 hover:text-gray-700 font-medium"
                    >
                      Reset key
                    </button>
                    <button
                      onClick={() => setEditingId(editingId === device.id ? null : device.id)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      {editingId === device.id ? 'Close' : 'Edit'}
                    </button>
                  </div>
                </div>
                {editingId === device.id && (
                  <DeviceEditForm
                    device={device}
                    saving={updateMutation.isPending}
                    onCancel={() => setEditingId(null)}
                    onSave={(changes) => updateMutation.mutate({ id: device.id, ...changes })}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <ConfirmModalRoot />
    </div>
  )
}
