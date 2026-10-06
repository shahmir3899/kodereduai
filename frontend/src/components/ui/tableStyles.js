/**
 * Class constants for hand-written <table>s that can't use <DataTable> (matrix
 * grids like timetable / marks entry / attendance register). Using these keeps
 * their header, cell and row styling identical to DataTable's.
 *
 *   <thead className={THEAD}><tr><th className={th('right')}>Amount</th>…
 *   <tbody className={TBODY}><tr className={TR}><td className={td()}>…
 */
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' }

export const THEAD = 'bg-gray-50'
export const TBODY = 'divide-y divide-gray-100'
export const TR = 'hover:bg-gray-50'
export const th = (align = 'left') =>
  `px-4 py-3 ${ALIGN[align] || ALIGN.left} text-xs font-medium text-gray-500 uppercase whitespace-nowrap`
export const td = (align = 'left', extra = '') =>
  `px-4 py-3 text-sm text-gray-900 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''} ${extra}`.trim()
