const classOptionCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export function normalizeClassOrderingText(value) {
  return String(value || '').trim()
}

export function normalizeOrderingKey(value) {
  return normalizeClassOrderingText(value).toLowerCase().replace(/\s+/g, ' ')
}

export function parseClassLevel(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER
}

export function parseSectionOrder(section) {
  const raw = normalizeClassOrderingText(section)
  if (!raw) return -1

  const numeric = Number(raw)
  if (!Number.isNaN(numeric)) return numeric

  return raw
    .toUpperCase()
    .split('')
    .reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0)
}

export function compareClassLabels(leftLabel, rightLabel) {
  return classOptionCollator.compare(
    normalizeClassOrderingText(leftLabel),
    normalizeClassOrderingText(rightLabel)
  )
}

function getComparableName(option) {
  return normalizeClassOrderingText(option?.name || option?.display_name || option?.label)
}

function getComparableSection(option) {
  return normalizeClassOrderingText(option?.section)
}

function getComparableGrade(option) {
  return parseClassLevel(option?.grade_level ?? option?.level)
}

export function sortClassOptions(options = []) {
  return [...options].sort((left, right) => {
    const gradeDiff = getComparableGrade(left) - getComparableGrade(right)
    if (gradeDiff !== 0) return gradeDiff

    const nameDiff = classOptionCollator.compare(getComparableName(left), getComparableName(right))
    if (nameDiff !== 0) return nameDiff

    const sectionDiff = classOptionCollator.compare(getComparableSection(left), getComparableSection(right))
    if (sectionDiff !== 0) return sectionDiff

    return compareClassLabels(left?.label, right?.label)
  })
}

export function buildClassOrderMaps({ classes = [], sessionClasses = [] } = {}) {
  const byClassId = new Map()
  const bySessionClassId = new Map()
  const byLabel = new Map()

  classes.forEach((cls) => {
    const level = parseClassLevel(cls?.grade_level ?? cls?.level)
    const section = normalizeClassOrderingText(cls?.section)
    const sectionOrder = parseSectionOrder(section)
    const name = normalizeClassOrderingText(cls?.name)
    const label = section ? `${name} - ${section}` : name

    if (cls?.id != null) {
      byClassId.set(Number(cls.id), { level, sectionOrder })
    }

    if (name) {
      byLabel.set(normalizeOrderingKey(name), { level, sectionOrder: -1 })
    }

    if (label) {
      byLabel.set(normalizeOrderingKey(label), { level, sectionOrder })
    }
  })

  sessionClasses.forEach((cls) => {
    const level = parseClassLevel(cls?.grade_level ?? cls?.level)
    const section = normalizeClassOrderingText(cls?.section)
    const sectionOrder = parseSectionOrder(section)
    const baseName = normalizeClassOrderingText(cls?.display_name || cls?.name)
    const label = normalizeClassOrderingText(cls?.label || (section ? `${baseName} - ${section}` : baseName))

    if (cls?.id != null) {
      bySessionClassId.set(Number(cls.id), { level, sectionOrder })
    }

    if (baseName) {
      byLabel.set(normalizeOrderingKey(baseName), { level, sectionOrder: -1 })
    }

    if (label) {
      byLabel.set(normalizeOrderingKey(label), { level, sectionOrder })
    }
  })

  return { byClassId, bySessionClassId, byLabel }
}

export function getClassSortMeta(item, classOrderMaps) {
  if (!classOrderMaps) {
    return { level: Number.MAX_SAFE_INTEGER, sectionOrder: Number.MAX_SAFE_INTEGER }
  }

  if (item?.session_class_id != null && classOrderMaps.bySessionClassId.has(Number(item.session_class_id))) {
    return classOrderMaps.bySessionClassId.get(Number(item.session_class_id))
  }

  if (item?.class_id != null && classOrderMaps.byClassId.has(Number(item.class_id))) {
    return classOrderMaps.byClassId.get(Number(item.class_id))
  }

  const byLabel = classOrderMaps.byLabel.get(normalizeOrderingKey(item?.class_name))
  if (byLabel) return byLabel

  return { level: Number.MAX_SAFE_INTEGER, sectionOrder: Number.MAX_SAFE_INTEGER }
}
