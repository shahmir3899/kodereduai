import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'

const STATUS_COLORS = {
  Paid: '#16a34a',
  Partial: '#ea580c',
  Unpaid: '#dc2626',
  Advance: '#2563eb',
}

export default function FeeCharts({ summaryData }) {
  if (!summaryData) return null

  const byClass = (summaryData.by_class || []).map(cls => ({
    name: cls.class_name,
    'Total Fee': Number(cls.total_due),
    Received: Number(cls.total_collected),
  }))

  const statusData = [
    { name: 'Paid', value: summaryData.paid_count || 0 },
    { name: 'Partial', value: summaryData.partial_count || 0 },
    { name: 'Unpaid', value: summaryData.unpaid_count || 0 },
    { name: 'Advance', value: summaryData.advance_count || 0 },
  ].filter(d => d.value > 0)

  const totalStudents = statusData.reduce((s, d) => s + d.value, 0)

  if (byClass.length === 0 && statusData.length === 0) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
      {/* Class-wise Collection Bar Chart */}
      {byClass.length > 0 && (
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Class-wise Collection</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byClass} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                <Tooltip formatter={(value) => value.toLocaleString()} />
                <Bar dataKey="Total Fee" fill="#d1d5db" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Received" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-2 text-xs text-gray-600">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-gray-300 rounded" />
              <span>Total Fee</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 bg-green-600 rounded" />
              <span>Received</span>
            </div>
          </div>
        </div>
      )}

      {/* Payment Status Donut */}
      {statusData.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Payment Status</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {statusData.map((entry) => (
                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [`${value} students`, name]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="text-center text-xs text-gray-500 mt-1">{totalStudents} total students</p>
        </div>
      )}
    </div>
  )
}
