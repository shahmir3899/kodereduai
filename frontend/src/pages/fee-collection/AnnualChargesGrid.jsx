/**
 * AnnualChargesGrid — Excel-like grid for entering annual charge amounts per category.
 *
 * Props:
 *   categories      — array of { id, name, description } from AnnualFeeCategory
 *   rows            — array of { category_id, annual_category_name, amount }
 *   onChange(rows)  — called when any row changes
 *   onAddRow()      — called when "Add Row" is clicked
 */
export default function AnnualChargesGrid({ categories = [], rows = [], onChange, onAddRow }) {
  function updateRow(index, field, value) {
    const updated = rows.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    onChange(updated)
  }

  function removeRow(index) {
    onChange(rows.filter((_, i) => i !== index))
  }

  const total = rows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-5 text-center text-sm text-gray-400 italic">
          No charges added yet. Select a category or click "Add Row".
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Charge {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="rounded px-2 py-0.5 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                  title="Remove row"
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Category
                  </label>
                  <select
                    value={row.category_id || ''}
                    onChange={(e) => {
                      const cat = categories.find((c) => String(c.id) === e.target.value)
                      onChange(rows.map((r, i) =>
                        i === index
                          ? { ...r, category_id: e.target.value, annual_category_name: cat ? cat.name : r.annual_category_name }
                          : r
                      ))
                    }}
                    className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="">Select category</option>
                    {categories.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Amount
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={row.amount}
                    onChange={(e) => updateRow(index, 'amount', e.target.value)}
                    placeholder="0"
                    className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-2 text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total per Student / Year</span>
          <span className="text-sm font-bold text-green-700">Rs. {total.toLocaleString()}</span>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={onAddRow}
          className="px-3 py-1.5 text-sm text-primary-700 border border-dashed border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
        >
          + Add Charge
        </button>
      </div>
    </div>
  )
}
