import { useState } from 'react'
import ClassSelector from '../../components/ClassSelector'

// Where a device runs decides its embedding space: a browser/tablet uses face-api.js
// (faceapi_v1), the on-prem mini PC uses dlib (dlib_v1). Fixed at creation.
export const RUNS_ON = {
  browser: { embedding_version: 'faceapi_v1', label: 'This browser or a tablet', hint: 'Runs the camera right here — no extra hardware. Marks attendance automatically.' },
  onprem: { embedding_version: 'dlib_v1', label: 'An on-prem mini PC', hint: 'A separate always-on machine at school running the capture software.' },
}

/** Form for registering a new capture device. The page owns the request. */
export function AddDevicePanel({ onSubmit, onCancel, saving }) {
  const [name, setName] = useState('')
  const [runsOn, setRunsOn] = useState('browser')
  const [scope, setScope] = useState('SCHOOL')
  const [classObj, setClassObj] = useState('')

  const canSave = name.trim() && (scope === 'SCHOOL' || classObj)

  const submit = (e) => {
    e.preventDefault()
    if (!canSave) return
    onSubmit({
      name: name.trim(),
      scope_type: scope,
      class_obj: scope === 'CLASS' ? parseInt(classObj, 10) : null,
      embedding_version: RUNS_ON[runsOn].embedding_version,
    })
  }

  return (
    <form onSubmit={submit} className="p-4 border-b bg-gray-50 space-y-4" data-testid="add-device-panel">
      <h2 className="text-sm font-semibold text-gray-900">Add a capture device</h2>

      <div>
        <label htmlFor="device-name" className="block text-xs font-medium text-gray-700 mb-1">Name</label>
        <input
          id="device-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='e.g. "Front Gate Tablet"'
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>

      <fieldset>
        <legend className="block text-xs font-medium text-gray-700 mb-1">Where will it run?</legend>
        <div className="space-y-2">
          {Object.entries(RUNS_ON).map(([id, opt]) => (
            <label key={id} className="flex items-start gap-2 text-sm">
              <input type="radio" name="runs-on" checked={runsOn === id} onChange={() => setRunsOn(id)} className="mt-1" />
              <span>
                <span className="font-medium text-gray-900">{opt.label}</span>
                <span className="block text-xs text-gray-500">{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="block text-xs font-medium text-gray-700 mb-1">Who should it recognise?</legend>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="scope" checked={scope === 'SCHOOL'} onChange={() => setScope('SCHOOL')} />
            Whole school (e.g. an entrance camera)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="scope" checked={scope === 'CLASS'} onChange={() => setScope('CLASS')} />
            One class (e.g. a classroom camera)
          </label>
          {scope === 'CLASS' && (
            <ClassSelector
              value={classObj}
              onChange={(e) => setClassObj(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              aria-label="Class"
            />
          )}
        </div>
      </fieldset>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSave || saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add device'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm">
          Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * Shown right after a device is created or its key is reset: the raw key appears
 * once, here. For a browser device it can start the automatic camera straight away.
 */
export function DeviceKeyReveal({ device, onStartAutoCamera, onDone }) {
  const [copied, setCopied] = useState(false)
  const isBrowserDevice = device.embedding_version === RUNS_ON.browser.embedding_version

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(device.api_key)
      setCopied(true)
    } catch {
      setCopied(false) // clipboard blocked — the key is still selectable on screen
    }
  }

  return (
    <div className="p-4 border-b bg-green-50 space-y-3" data-testid="device-key-reveal">
      <h2 className="text-sm font-semibold text-green-900">
        {device.name} is ready
      </h2>
      <div>
        <p className="text-xs font-medium text-green-900 mb-1">Device key — shown only once</p>
        <div className="flex gap-2">
          <code className="flex-1 min-w-0 break-all bg-white border border-green-200 rounded px-2 py-1.5 text-xs select-all" data-testid="device-key">
            {device.api_key}
          </code>
          <button onClick={copy} className="px-3 py-1.5 bg-white border border-green-300 rounded text-xs font-medium">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="text-xs text-green-800 mt-1">
          Save it now — it can&apos;t be shown again. If it&apos;s lost, use &ldquo;Reset key&rdquo; to get a new one.
        </p>
      </div>

      {isBrowserDevice ? (
        <div className="space-y-2">
          <p className="text-sm text-green-900">
            This device runs in a browser. Start it on this screen and it will recognise students and mark attendance
            automatically — you can leave it running, for example on a tablet at the gate.
          </p>
          <button
            onClick={onStartAutoCamera}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
          >
            Start auto camera on this device
          </button>
        </div>
      ) : (
        <div className="text-sm text-green-900 space-y-1" data-testid="onprem-steps">
          <p className="font-medium">Set it up on the mini PC</p>
          <ol className="list-decimal pl-5 space-y-0.5 text-xs">
            <li>Install Docker on the mini PC and copy the <code>infra/face-capture-device</code> folder to it.</li>
            <li>Copy <code>.env.example</code> to <code>.env</code> and set <code>DEVICE_KEY</code> to the key above, plus <code>CAMERA_SOURCE</code> and <code>API_BASE_URL</code>.</li>
            <li>Run <code>docker compose up -d --build</code>. This page will show the device as Online within a minute.</li>
          </ol>
        </div>
      )}

      <button onClick={onDone} className="text-xs text-green-800 underline">
        I&apos;ve saved the key — close
      </button>
    </div>
  )
}
