import Modal from '../../../components/ui/Modal'
import Button from '../../../components/ui/Button'
import Field from '../../../components/ui/Field'
import { ENTRY_SWATCHES, DEFAULT_EVENT_COLOR } from '../../../components/academic/academicTones'
import { OFF_DAY_TYPES, classLabel } from './calendarUtils'

function Section({ title, children }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{title}</legend>
      {children}
    </fieldset>
  )
}

/** Add / edit an event or off day, grouped as What it is, When it runs and Who it applies to. */
export default function EntryFormModal({ editing, form, setForm, formErrors, displayClasses, onToggleClass, onSubmit, onClose, saving }) {
  const set = (patch) => setForm((cur) => ({ ...cur, ...patch }))
  const isOff = form.entry_kind === 'OFF_DAY'

  return (
    <Modal open onClose={onClose} size="2xl" title={editing ? 'Edit Event / Off Day' : 'Add Event / Off Day'}>
      <form className="space-y-5" onSubmit={onSubmit}>
        <Section title="What">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Title" required error={formErrors.name ? String(formErrors.name) : undefined} className="sm:col-span-2">
              <input
                required
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                className="input w-full"
                placeholder="Independence Day / Eid Holiday / Orange Color Day"
              />
            </Field>

            <Field label="Type">
              <select value={form.entry_kind} onChange={(e) => set({ entry_kind: e.target.value })} className="input w-full">
                <option value="EVENT">Event</option>
                <option value="OFF_DAY">OFF Day</option>
              </select>
            </Field>

            {isOff ? (
              <Field label="OFF Day Category">
                <select value={form.off_day_type} onChange={(e) => set({ off_day_type: e.target.value })} className="input w-full">
                  {OFF_DAY_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <div />
            )}

            <div className="sm:col-span-2">
              <span className="label">Color Tag</span>
              <div className="flex flex-wrap items-center gap-2">
                {ENTRY_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Use colour ${hex}`}
                    aria-pressed={form.color?.toLowerCase() === hex}
                    onClick={() => set({ color: hex })}
                    className={`h-7 w-7 rounded-full ring-offset-2 dark:ring-offset-gray-800 ${form.color?.toLowerCase() === hex ? 'ring-2 ring-gray-900 dark:ring-white' : 'ring-1 ring-gray-200 dark:ring-gray-600'}`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
                <input
                  type="color"
                  aria-label="Custom colour"
                  value={form.color || DEFAULT_EVENT_COLOR}
                  onChange={(e) => set({ color: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border border-gray-300 p-0.5 dark:border-gray-600"
                />
              </div>
            </div>

            <Field label="Description" className="sm:col-span-2">
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                className="input w-full"
                placeholder="Optional details for teachers and attendance teams"
              />
            </Field>
          </div>
        </Section>

        <Section title="When">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Start Date" required>
              <input required type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} className="input w-full" />
            </Field>
            <Field label="End Date" required error={formErrors.end_date ? String(formErrors.end_date) : undefined}>
              <input required type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} className="input w-full" />
            </Field>
          </div>
        </Section>

        <Section title="Who">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Scope" error={formErrors.class_ids ? String(formErrors.class_ids) : undefined}>
              <select value={form.scope} onChange={(e) => set({ scope: e.target.value, class_ids: [] })} className="input w-full">
                <option value="SCHOOL">Whole School</option>
                <option value="CLASS">Specific Classes</option>
              </select>
            </Field>

            {isOff && (
              <div>
                <span className="label">Applies To</span>
                <div className="mt-2 flex flex-col gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" checked={form.affects_students} onChange={(e) => set({ affects_students: e.target.checked })} className="rounded" />
                    <span>Students <span className="text-xs text-gray-500 dark:text-gray-400">(attendance N/A)</span></span>
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input type="checkbox" checked={form.affects_staff} onChange={(e) => set({ affects_staff: e.target.checked })} className="rounded" />
                    <span>Staff <span className="text-xs text-gray-500 dark:text-gray-400">(auto ON_LEAVE)</span></span>
                  </label>
                  {!form.affects_students && !form.affects_staff && (
                    <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-300">Select at least one.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {form.scope === 'CLASS' && (
            <div>
              <span className="label">Select Classes</span>
              <div className="grid max-h-44 grid-cols-2 gap-2 overflow-auto rounded-lg border border-gray-200 p-3 sm:grid-cols-3 dark:border-gray-700">
                {displayClasses.length === 0 && <p className="text-xs text-gray-500 dark:text-gray-400">No classes available</p>}
                {displayClasses.map((cls) => {
                  const id = String(cls.id)
                  return (
                    <label key={cls.id} className="inline-flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                      <input type="checkbox" checked={form.class_ids.includes(id)} onChange={() => onToggleClass(id)} />
                      <span>{classLabel(cls)}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </Section>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{editing ? 'Update' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  )
}
