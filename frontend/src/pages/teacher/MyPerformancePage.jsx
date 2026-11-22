import PageHeader from '../../components/ui/PageHeader'
import PeriodPicker, { usePeriod } from '../hr/teacherPerformance/PeriodPicker'
import TeacherPerformanceDetail from '../hr/teacherPerformance/TeacherPerformanceDetail'

/** A teacher's own performance report: same breakdown the school's admins see, own figures only. */
export default function MyPerformancePage() {
  const period = usePeriod()
  return (
    <div className="space-y-6">
      <PageHeader
        title="My Performance"
        subtitle="Work done against work due. Holidays and approved leave never count against you."
        actions={<PeriodPicker {...period} />}
      />
      <TeacherPerformanceDetail mine range={period.range} />
    </div>
  )
}
