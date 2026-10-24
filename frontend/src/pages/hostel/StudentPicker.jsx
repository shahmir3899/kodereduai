import { useMemo, useState } from 'react'

/**
 * Search box + select for choosing one student, replacing the typed "Student ID" boxes.
 * `students` is the roster list from studentsApi.getStudents; `excludeIds` hides students
 * who can't be chosen (for example already in a hostel).
 */
export default function StudentPicker({ students, value, onChange, excludeIds, id }) {
  const [search, setSearch] = useState('')

  const options = useMemo(() => {
    const term = search.trim().toLowerCase()
    return students
      .filter((s) => !excludeIds || !excludeIds.has(s.id))
      .filter((s) => !term
        || s.name?.toLowerCase().includes(term)
        || s.roll_number?.toLowerCase().includes(term)
        || s.class_name?.toLowerCase().includes(term))
      .slice(0, 100)
  }, [students, search, excludeIds])

  return (
    <div className="space-y-2">
      <input
        type="search"
        className="input"
        placeholder="Search by name, roll number or class"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search students"
      />
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">-- Select Student --</option>
        {options.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}{s.class_name ? ` (${s.class_name})` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
