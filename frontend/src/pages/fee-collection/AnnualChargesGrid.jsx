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
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-1/2">
                Category
              </th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide w-2/5">
                Amount (PKR)
              </th>
              <th className="px-4 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400 italic">
                  No charges added yet. Select a category or click "Add Row".
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index} className="hover:bg-gray-50 transition-colors">
                  <td className="px-3 py-2">
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
                      className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
                    >
                      <option value="">— Select category —</option>
                      {categories.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={row.amount}
                      onChange={(e) => updateRow(index, 'amount', e.target.value)}
                      placeholder="0"
                      className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none font-light"
                      title="Remove row"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td className="px-4 py-2 text-sm font-semibold text-gray-700">Total per Student / Year</td>
                <td className="px-4 py-2 text-right text-sm font-bold text-green-700">
                  {total.toLocaleString()}
                </td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <button
        type="button"
        onClick={onAddRow}
        className="px-3 py-1.5 text-sm text-primary-700 border border-dashed border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
      >
        + Add Row
      </button>
    </div>
  )
}
