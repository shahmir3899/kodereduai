export default function TopicStatusBadge({ topic }) {
  if (!topic) return null

  if (topic.is_covered && topic.is_tested) {
    return <span className="px-2 py-0.5 text-xs rounded bg-green-100 text-green-700">Taught & Tested</span>
  }
  if (topic.is_covered && !topic.is_tested) {
    return <span className="px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-700">Taught only</span>
  }
  if (!topic.is_covered && topic.is_tested) {
    return <span className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-700">Tested only</span>
  }
  return <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600">Not covered</span>
}
