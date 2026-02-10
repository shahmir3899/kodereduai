export default function FeeSummaryCards({ summaryData }) {
  if (!summaryData) return null

  const byClass = summaryData.by_class || []
  const collectionRate = summaryData.total_due > 0
    ? Math.round((summaryData.total_collected / summaryData.total_due) * 100)
    : 0

  return (
    <div className="mb-6">
      {/* Overall totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="card">
          <p className="text-sm text-gray-500">Total Payable</p>
          <p className="text-xl font-bold text-gray-900">{Number(summaryData.total_due || 0).toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Received</p>
          <p className="text-xl font-bold text-green-700">{Number(summaryData.total_collected || 0).toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Balance</p>
          <p className="text-xl font-bold text-orange-700">{Number(summaryData.total_pending || 0).toLocaleString()}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Collection Rate</p>
          <p className="text-xl font-bold text-blue-700">{collectionRate}%</p>
        </div>
      </div>

      {/* Class-wise breakdown */}
      {byClass.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Class-wise Breakdown</h3>

          {/* Mobile: cards */}
          <div className="sm:hidden space-y-2">
            {byClass.map((cls) => {
              const balance = Number(cls.total_due) - Number(cls.total_collected)
              return (
                <div key={cls.class_id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{cls.class_name}</p>
                    <p className="text-xs text-gray-500">{cls.count} students</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">{Number(cls.total_due).toLocaleString()}</p>
                    <p className="text-xs">
                      <span className="text-green-700">{Number(cls.total_collected).toLocaleString()}</span>
                      {balance > 0 && <span className="text-orange-700 ml-2">-{balance.toLocaleString()}</span>}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase py-2 pr-4">Class</th>
                  <th className="text-center text-xs font-medium text-gray-500 uppercase py-2 px-4">Students</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase py-2 px-4">Total Fee</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase py-2 px-4">Received</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase py-2 pl-4">Balance</th>
                </tr>
              </thead>
              <tbody>
                {byClass.map((cls) => {
                  const balance = Number(cls.total_due) - Number(cls.total_collected)
                  return (
                    <tr key={cls.class_id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-4 text-sm font-medium text-gray-900">{cls.class_name}</td>
                      <td className="py-2 px-4 text-sm text-gray-500 text-center">{cls.count}</td>
                      <td className="py-2 px-4 text-sm text-gray-900 text-right">{Number(cls.total_due).toLocaleString()}</td>
                      <td className="py-2 px-4 text-sm text-green-700 text-right">{Number(cls.total_collected).toLocaleString()}</td>
                      <td className={`py-2 pl-4 text-sm font-medium text-right ${balance > 0 ? 'text-orange-700' : 'text-green-700'}`}>
                        {balance.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
