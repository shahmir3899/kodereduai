import { useQuery } from '@tanstack/react-query'
import { libraryApi } from '../../services/api'
import { useDebounce } from '../../hooks/useDebounce'
import Field from '../../components/ui/Field'
import { borrowerName, listOf } from './libraryUtils'

// Search box with a result list that turns into a name chip once something is chosen,
// so nobody has to know or type a database id.
function SearchPicker({ label, required, placeholder, query, setQuery, selected, onSelect, onClear, results, renderOption, enabled }) {
  return (
    <Field label={label} required={required} className="relative">
      {selected ? (
        <div className="input flex items-center justify-between gap-2" data-testid="picker-chip">
          <span className="truncate font-medium text-gray-900">{selected}</span>
          <button type="button" onClick={onClear} className="text-xs text-gray-500 hover:text-gray-700" aria-label={`Clear ${label}`}>
            Change
          </button>
        </div>
      ) : (
        <input
          type="text"
          className="input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {!selected && enabled && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">No matches found.</p>
          ) : results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
            >
              {renderOption(r)}
            </button>
          ))}
        </div>
      )}
    </Field>
  )
}

/**
 * The shared "who gets which book, until when" fields. The catalog quick-issue modal passes a
 * fixed `book`; the Issue page leaves it out and shows a book search instead.
 * `form` is { borrower_type, borrower, book, due_date, notes } where borrower/book are picked
 * objects (or null), so the chip can show a name rather than an id.
 */
export default function IssueFields({ form, setForm, fixedBook }) {
  const borrowerQuery = form.borrowerQuery || ''
  const bookQuery = form.bookQuery || ''
  const debouncedBorrower = useDebounce(borrowerQuery, 300)
  const debouncedBook = useDebounce(bookQuery, 300)
  const isStudent = form.borrower_type === 'STUDENT'
  const patch = (changes) => setForm((f) => ({ ...f, ...changes }))

  const { data: borrowerRes } = useQuery({
    queryKey: ['borrowerSearch', form.borrower_type, debouncedBorrower],
    queryFn: () => (isStudent
      ? libraryApi.searchStudents({ search: debouncedBorrower, page_size: 20 })
      : libraryApi.searchStaff({ search: debouncedBorrower, page_size: 20 })),
    enabled: !form.borrower && debouncedBorrower.length >= 2,
  })

  const { data: bookRes } = useQuery({
    queryKey: ['bookSearch', debouncedBook],
    queryFn: () => libraryApi.getBooks({ search: debouncedBook, is_active: 'true', page_size: 20 }),
    enabled: !fixedBook && !form.book && debouncedBook.length >= 2,
  })

  const availableBooks = listOf(bookRes).filter((b) => b.available_copies > 0)

  return (
    <div className="space-y-4">
      <div>
        <p className="label">Borrower Type <span className="text-red-500">*</span></p>
        <div className="flex gap-6">
          {[['STUDENT', 'Student'], ['STAFF', 'Staff']].map(([value, text]) => (
            <label key={value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="borrower_type"
                value={value}
                checked={form.borrower_type === value}
                onChange={() => patch({ borrower_type: value, borrower: null, borrowerQuery: '' })}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{text}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SearchPicker
          label={isStudent ? 'Student' : 'Staff Member'}
          required
          placeholder={`Type 2+ letters of the ${isStudent ? 'student' : 'staff'} name`}
          query={borrowerQuery}
          setQuery={(q) => patch({ borrowerQuery: q })}
          selected={form.borrower ? borrowerName(form.borrower) : ''}
          onSelect={(b) => patch({ borrower: b, borrowerQuery: '' })}
          onClear={() => patch({ borrower: null, borrowerQuery: '' })}
          results={listOf(borrowerRes)}
          enabled={debouncedBorrower.length >= 2}
          renderOption={(b) => (
            <>
              <p className="font-medium text-gray-900">{borrowerName(b)}</p>
              <p className="text-xs text-gray-500">
                {isStudent
                  ? [b.roll_number && `Roll #${b.roll_number}`, b.class_name].filter(Boolean).join(' - ')
                  : (b.designation_name || b.department_name || '')}
              </p>
            </>
          )}
        />

        {fixedBook ? (
          <Field label="Book">
            <div className="input font-medium text-gray-900 truncate">{fixedBook.title}</div>
          </Field>
        ) : (
          <SearchPicker
            label="Book"
            required
            placeholder="Type 2+ letters of the title"
            query={bookQuery}
            setQuery={(q) => patch({ bookQuery: q })}
            selected={form.book ? form.book.title : ''}
            onSelect={(b) => patch({ book: b, bookQuery: '' })}
            onClear={() => patch({ book: null, bookQuery: '' })}
            results={availableBooks}
            enabled={debouncedBook.length >= 2}
            renderOption={(b) => (
              <>
                <p className="font-medium text-gray-900">{b.title}</p>
                <p className="text-xs text-gray-500">
                  {b.author}{b.isbn ? ` | ISBN: ${b.isbn}` : ''} | Available: {b.available_copies}
                </p>
              </>
            )}
          />
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Due Date" required>
          <input
            type="date"
            required
            className="input"
            value={form.due_date}
            onChange={(e) => patch({ due_date: e.target.value })}
          />
        </Field>
        <Field label="Notes">
          <input
            type="text"
            className="input"
            placeholder="Optional notes..."
            value={form.notes}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </Field>
      </div>
    </div>
  )
}

// Request body for POST /api/library/issues/ from an IssueFields form.
export function issuePayload(form, book) {
  return {
    book: (book || form.book).id,
    borrower_type: form.borrower_type,
    [form.borrower_type === 'STAFF' ? 'staff' : 'student']: form.borrower.id,
    due_date: form.due_date,
    notes: form.notes,
  }
}
