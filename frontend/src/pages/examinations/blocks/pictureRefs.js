// Pure helpers for picture references, shared with the phone app (scripts/build-rich-editor.mjs copies this
// file to mobile/services/shared/). No React and no imports here, so the copy works as it is.
//
// A picture reference is what a paper stores: a library name ("apple"), a school upload
// ({ upload: 12 }), a picture drawn by the server's code ({ make: 'clock', time: '3:30' }), or an
// old paper's stored diagram ({ url }). See backend examinations/paper_blocks/registry.py.

export function describePicture(ref, { catalog = [], uploads = [] } = {}) {
  if (!ref) return null
  if (typeof ref === 'string') {
    const entry = catalog.find((e) => e.name === ref)
    return { label: entry ? entry.en : ref, image: entry?.url || null }
  }
  if (ref.upload) {
    const upload = uploads.find((u) => u.id === ref.upload)
    return { label: upload?.label || `Picture ${ref.upload}`, image: upload?.image_url || null }
  }
  if (ref.url) return { label: 'Picture from the old paper', image: ref.url }
  if (ref.make) {
    const details = Object.entries(ref).filter(([k]) => k !== 'make' && k !== 'picture').map(([k, v]) => `${k} ${v}`).join(', ')
    return { label: `Drawn: ${ref.make}${details ? ` (${details})` : ''}`, image: null }
  }
  return { label: 'Picture', image: null }
}

/**
 * "butterfly 3, flower 2, pencil" -> library pictures, each with its count when one is given. Names match
 * exactly (English, Urdu or the file name), the rule Enter uses in the picker, so "flower" never becomes
 * "Flower pot"; a name with no exact match is handed back in ``unknown``, never guessed. One search per
 * picture was 15 picker openings in the demo paper (faster 4).
 */
export function picturesFromNames(text, catalog = []) {
  const found = []
  const unknown = []
  String(text ?? '').split(/[,\n،]/).map((part) => part.trim()).filter(Boolean).forEach((part) => {
    let name = part
    let count
    const tail = part.match(/^(.*\S)\s+(\d+)$/)
    const head = part.match(/^(\d+)\s+(.+)$/)
    if (tail) { name = tail[1]; count = Number(tail[2]) } else if (head) { name = head[2]; count = Number(head[1]) }
    const wanted = name.trim().toLowerCase()
    const entry = catalog.find((e) => String(e.en || '').toLowerCase() === wanted
      || String(e.name || '').toLowerCase() === wanted || (e.ur && e.ur === name.trim()))
    if (!entry) unknown.push(name.trim())
    else found.push(count === undefined ? { picture: entry.name } : { picture: entry.name, count })
  })
  return { found, unknown }
}

/** Starting values for the "Create" tab's fields of one code-drawn kind (server MAKERS). */
export function makerDefaults(maker) {
  const values = {}
  Object.entries(maker?.fields || {}).forEach(([name, field]) => {
    if (field.optional) return
    if (field.type === 'choice') values[name] = field.choices?.[0]
    else if (field.type === 'int') values[name] = Math.min(field.max ?? 3, Math.max(field.min ?? 1, 3))
    else if (field.type === 'number') values[name] = name === 'end' ? 10 : 0
    else if (field.type === 'text') values[name] = field.example || ''
    else if (field.type === 'picture') values[name] = 'apple'
  })
  return values
}

/** One Create-tab value changed: empty values are dropped so the server uses its own default. */
export function setMakerValue(values, name, value) {
  const next = { ...values }
  if (value === '' || value === undefined || (typeof value === 'number' && Number.isNaN(value))) delete next[name]
  else next[name] = value
  return next
}
