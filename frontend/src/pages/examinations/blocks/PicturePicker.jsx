import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Cropper from 'react-easy-crop'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { questionPaperApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { useDebounce } from '../../../hooks/useDebounce'
import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'

import { describePicture, makerDefaults, setMakerValue } from './pictureRefs'

export { describePicture }

const TABS = [
  { id: 'library', label: 'Library' },
  { id: 'uploads', label: 'My pictures' },
  { id: 'create', label: 'Create' },
]

export function usePictureLookups() {
  const { data: catalogRes } = useQuery({
    queryKey: ['paperPictureCatalog', ''],
    queryFn: () => questionPaperApi.getPictureCatalog(''),
    staleTime: 10 * 60 * 1000,
  })
  const { data: uploadsRes } = useQuery({
    queryKey: ['paperPictures', ''],
    queryFn: () => questionPaperApi.getPaperPictures({ page_size: 200 }),
    staleTime: 60 * 1000,
  })
  return {
    catalog: catalogRes?.data?.library || [],
    makers: catalogRes?.data?.makers || [],
    uploads: uploadsRes?.data?.results || [],
  }
}

function LibraryTab({ onPick }) {
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)
  const { data, isLoading } = useQuery({
    queryKey: ['paperPictureCatalog', debounced],
    queryFn: () => questionPaperApi.getPictureCatalog(debounced),
    staleTime: 10 * 60 * 1000,
  })
  const pictures = data?.data?.library || []
  // Enter picks the picture asked for: its exact name first ("flower", not "Flower pot"), else the first match.
  // Only once the results belong to what was typed (demo findings B3).
  // Enter pressed before the results caught up is remembered and done when they arrive, so a fast typist's
  // Enter is not lost.
  const pendingEnter = useRef(false)
  const pickBest = () => {
    const wanted = search.trim().toLowerCase()
    if (!wanted) return
    if (debounced !== search || isLoading) { pendingEnter.current = true; return }
    pendingEnter.current = false
    if (!pictures.length) return
    const exact = pictures.find((p) => String(p.en || '').toLowerCase() === wanted || p.ur === search.trim())
    onPick((exact || pictures[0]).name)
  }
  useEffect(() => {
    if (pendingEnter.current && debounced === search && !isLoading) pickBest()
  })
  return (
    <div>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pickBest() } }}
        aria-label="Search pictures"
        placeholder="Search in English or Urdu, e.g. apple, سیب, fruit (Enter picks)"
        className="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg"
        autoFocus
      />
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading pictures…</p>
      ) : pictures.length === 0 ? (
        <p className="text-sm text-gray-500">No picture matches “{debounced}”. Try another word, or upload your own.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-[55vh] overflow-y-auto pr-1">
          {pictures.map((picture) => (
            <button
              key={picture.name}
              type="button"
              onClick={() => onPick(picture.name)}
              className="border border-gray-200 rounded-lg p-2 hover:border-blue-500 hover:bg-blue-50 text-center"
            >
              <img src={picture.url} alt="" loading="lazy" className="w-full h-16 object-contain" />
              <span className="block text-xs text-gray-700 mt-1 truncate">{picture.en}</span>
              <span className="block text-xs text-gray-500 truncate" dir="rtl" lang="ur">{picture.ur}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

async function cropToBlob(imageSrc, pixels) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = imageSrc
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(pixels.width))
  canvas.height = Math.max(1, Math.round(pixels.height))
  canvas.getContext('2d').drawImage(image, pixels.x, pixels.y, pixels.width, pixels.height, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

const ASPECTS = [
  { id: 'free', label: 'As taken', value: null },
  { id: 'square', label: 'Square', value: 1 },
  { id: 'wide', label: 'Wide 4:3', value: 4 / 3 },
  { id: 'tall', label: 'Tall 3:4', value: 3 / 4 },
]

function UploadsTab({ onPick }) {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)
  const { data, isLoading } = useQuery({
    queryKey: ['paperPictures', debounced],
    queryFn: () => questionPaperApi.getPaperPictures({ page_size: 200, ...(debounced ? { search: debounced } : {}) }),
  })
  const uploads = data?.data?.results || []

  // Crop step: the chosen file is shown with a crop box before anything is uploaded.
  const [source, setSource] = useState(null)
  const [label, setLabel] = useState('')
  const [clean, setClean] = useState(true)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [aspect, setAspect] = useState(null)
  const [naturalAspect, setNaturalAspect] = useState(1)
  const [pixels, setPixels] = useState(null)

  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url) }, [source])

  const chooseFile = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      showError('Choose a PNG, JPG or WebP picture.')
      return
    }
    const url = URL.createObjectURL(file)
    const probe = new Image()
    probe.onload = () => setNaturalAspect(probe.width / probe.height || 1)
    probe.src = url
    setSource({ url, name: file.name })
    setLabel(file.name.replace(/\.[^.]+$/, ''))
    setZoom(1)
    setCrop({ x: 0, y: 0 })
    setAspect(null)
  }

  const upload = useMutation({
    mutationFn: async () => {
      const blob = pixels ? await cropToBlob(source.url, pixels) : await fetch(source.url).then((r) => r.blob())
      const file = new File([blob], `${label || 'picture'}.png`, { type: 'image/png' })
      return questionPaperApi.uploadPaperPicture({ file, label, clean })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['paperPictures'] })
      showSuccess('Picture saved to your school’s pictures.')
      setSource(null)
      onPick({ upload: res.data.id })
    },
    onError: (err) => showError(err?.response?.data?.error || 'The picture could not be uploaded.'),
  })

  const remove = useMutation({
    mutationFn: (id) => questionPaperApi.deletePaperPicture(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['paperPictures'] }),
    onError: (err) => showError(err?.response?.data?.detail || 'The picture could not be deleted.'),
  })

  if (source) {
    return (
      <div>
        <div className="relative w-full h-72 bg-gray-900 rounded-lg overflow-hidden">
          <Cropper
            image={source.url}
            crop={crop}
            zoom={zoom}
            aspect={aspect || naturalAspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, area) => setPixels(area)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {ASPECTS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAspect(option.value)}
              className={`px-2.5 py-1 rounded-full text-xs border ${aspect === option.value ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700'}`}
            >
              {option.label}
            </button>
          ))}
          <label className="flex items-center gap-2 text-xs text-gray-600 ml-auto">
            Zoom
            <input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <label className="text-sm text-gray-700">
            What it shows
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700 sm:mt-6">
            <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} className="mt-1" />
            <span>Clean up a photo of a drawing (white paper, black lines). Turn off for a coloured picture.</span>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setSource(null)}>Cancel</Button>
          <Button loading={upload.isPending} onClick={() => upload.mutate()} disabled={!label.trim()}>Upload and use</Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <label className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm cursor-pointer hover:bg-blue-700">
          Browse…
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={chooseFile} />
        </label>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your school’s pictures"
          className="flex-1 min-w-[10rem] px-3 py-2 border border-gray-300 rounded-lg"
        />
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : uploads.length === 0 ? (
        <p className="text-sm text-gray-500">No pictures yet. Use Browse to add a photo or a scan; you can crop it first.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-[50vh] overflow-y-auto pr-1">
          {uploads.map((picture) => (
            <div key={picture.id} className="group relative border border-gray-200 rounded-lg p-2 text-center hover:border-blue-500">
              <button type="button" onClick={() => onPick({ upload: picture.id })} className="w-full">
                <img src={picture.image_url} alt="" loading="lazy" className="w-full h-16 object-contain" />
                <span className="block text-xs text-gray-700 mt-1 truncate">{picture.label}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete ${picture.label}`}
                onClick={() => remove.mutate(picture.id)}
                className="absolute top-1 right-1 hidden group-hover:block text-xs px-1.5 rounded bg-white border border-gray-300 text-red-600"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CreateTab({ makers, onPick, catalog }) {
  const [kind, setKind] = useState(makers[0]?.kind || '')
  const maker = makers.find((m) => m.kind === kind)
  const [values, setValues] = useState(() => (maker ? makerDefaults(maker) : {}))
  const [innerPickerOpen, setInnerPickerOpen] = useState(false)

  const choose = (nextKind) => {
    setKind(nextKind)
    const next = makers.find((m) => m.kind === nextKind)
    setValues(next ? makerDefaults(next) : {})
  }

  if (!maker) return <p className="text-sm text-gray-500">Loading…</p>
  const set = (name, value) => setValues((prev) => setMakerValue(prev, name, value))

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {makers.map((m) => (
          <button
            key={m.kind}
            type="button"
            onClick={() => choose(m.kind)}
            className={`px-3 py-1.5 rounded-full text-sm border ${m.kind === kind ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(maker.fields || {}).map(([name, field]) => (
          <label key={name} className="text-sm text-gray-700">
            {name.replace(/_/g, ' ')}{field.optional ? ' (optional)' : ''}
            {field.type === 'choice' ? (
              <select value={values[name] ?? ''} onChange={(e) => set(name, e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg">
                {field.optional && <option value="">—</option>}
                {field.choices.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : field.type === 'bool' ? (
              <select
                value={values[name] === undefined ? '' : values[name] ? 'yes' : 'no'}
                onChange={(e) => set(name, e.target.value === '' ? undefined : e.target.value === 'yes')}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">Default</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            ) : field.type === 'int' || field.type === 'number' ? (
              <input
                type="number"
                value={values[name] ?? ''}
                min={field.min}
                max={field.max}
                onChange={(e) => set(name, e.target.value === '' ? undefined : Number(e.target.value))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            ) : field.type === 'numbers' ? (
              <input
                value={(values[name] || []).join(', ')}
                placeholder="e.g. 15, 30"
                onChange={(e) => set(name, e.target.value.split(',').map((v) => v.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n)))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            ) : field.type === 'picture' ? (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-gray-800 truncate">{describePicture(values[name], { catalog })?.label || 'None'}</span>
                <Button size="sm" variant="secondary" onClick={() => setInnerPickerOpen(true)}>Choose</Button>
              </div>
            ) : (
              <input
                value={values[name] ?? ''}
                placeholder={field.example || ''}
                onChange={(e) => set(name, e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            )}
          </label>
        ))}
      </div>
      {innerPickerOpen && (
        <Modal open onClose={() => setInnerPickerOpen(false)} title="Picture to repeat" size="3xl" layer="top">
          <LibraryTab onPick={(ref) => { set('picture', ref); setInnerPickerOpen(false) }} />
        </Modal>
      )}
      <div className="flex justify-end mt-4">
        <Button onClick={() => onPick({ make: kind, ...values })}>Use this picture</Button>
      </div>
    </div>
  )
}

/** The picture chooser: library, the school's own uploads (with Browse and crop), or drawn by code. */
export default function PicturePicker({ open, onClose, onPick, allowCreate = true }) {
  const [tab, setTab] = useState('library')
  const { makers, catalog } = usePictureLookups()
  const tabs = useMemo(() => TABS.filter((t) => allowCreate || t.id !== 'create'), [allowCreate])
  const pick = useCallback((ref) => { onPick(ref); onClose() }, [onClose, onPick])
  if (!open) return null
  return (
    <Modal open onClose={onClose} title="Choose a picture" size="4xl" closeOnBackdrop={false}>
      <div className="flex gap-1 border-b border-gray-200 mb-4" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === t.id ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-600 hover:text-gray-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'library' && <LibraryTab onPick={pick} />}
      {tab === 'uploads' && <UploadsTab onPick={pick} />}
      {tab === 'create' && <CreateTab makers={makers} catalog={catalog} onPick={pick} />}
    </Modal>
  )
}
