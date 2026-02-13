// Standard presets for Pakistani schools
export const GRADE_PRESETS = [
  { name: 'Playgroup', numeric_level: 0 },
  { name: 'Nursery', numeric_level: 1 },
  { name: 'Prep', numeric_level: 2 },
  { name: 'Class 1', numeric_level: 3 },
  { name: 'Class 2', numeric_level: 4 },
  { name: 'Class 3', numeric_level: 5 },
  { name: 'Class 4', numeric_level: 6 },
  { name: 'Class 5', numeric_level: 7 },
  { name: 'Class 6', numeric_level: 8 },
  { name: 'Class 7', numeric_level: 9 },
  { name: 'Class 8', numeric_level: 10 },
  { name: 'Class 9', numeric_level: 11 },
  { name: 'Class 10', numeric_level: 12 },
]

// grade_level integer → display name
export const GRADE_LEVEL_LABELS = Object.fromEntries(
  GRADE_PRESETS.map(p => [p.numeric_level, p.name])
)
