export default function StudentStats({ stats }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
      <div className="card !p-4">
        <p className="text-xs font-medium text-gray-500 uppercase">Total Students</p>
        <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
      </div>
      <div className="card !p-4">
        <p className="text-xs font-medium text-gray-500 uppercase">Current</p>
        <p className="text-2xl font-bold text-green-600 mt-1">{stats.active}</p>
      </div>
      <div className="card !p-4">
        <p className="text-xs font-medium text-gray-500 uppercase">Left</p>
        <p className="text-2xl font-bold text-gray-400 mt-1">{stats.inactive}</p>
      </div>
      <div className="card !p-4">
        <p className="text-xs font-medium text-gray-500 uppercase">Classes</p>
        <p className="text-2xl font-bold text-primary-600 mt-1">{Object.keys(stats.byClass).length}</p>
      </div>
    </div>
  )
}
