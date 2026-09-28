import jsPDF from 'jspdf'
import JSZip from 'jszip'
import { buildReportData } from './reportCardData'
import { renderEnhanced } from './reportCardTemplates/enhanced'
import { renderTraditional } from './reportCardTemplates/traditional'
import { examinationsApi } from '../../services/api'

const RENDERERS = {
  enhanced: renderEnhanced,
  traditional: renderTraditional,
}

function safeName(value, fallback) {
  return String(value || fallback).replace(/[^a-zA-Z0-9]/g, '_')
}

/**
 * Builds a rendered report card doc for one student. Shared by the single-card
 * download and the bulk ZIP export so the two never drift apart.
 * @param {Object} params
 * @param {Object} params.report - Report card data from api.getReportCard()
 * @param {Object} params.schoolData - School details from schoolsApi.getMySchool()
 * @param {'enhanced'|'traditional'} [params.format]
 * @param {{url?: string, image?: any}} [params.logoCache] - Reused across a batch so the
 *   school logo is only fetched/decoded once per class, not once per student.
 */
async function renderReportCardDoc({ report, schoolData, format = 'enhanced', logoCache }) {
  const render = RENDERERS[format] || RENDERERS.enhanced
  const data = await buildReportData({ report, schoolData, logoCache })

  // compress: without it jsPDF stores images as raw pixels, so a 2500px logo alone
  // made each report card ~25 MB. Lossless, so image resolution is unchanged.
  const doc = new jsPDF({ compress: true })
  render(doc, data)
  return doc
}

/**
 * Generate and download a Report Card PDF.
 * @param {Object} params
 * @param {Object} params.report - Report card data from api.getReportCard()
 * @param {Object} params.schoolData - School details from schoolsApi.getMySchool()
 * @param {'enhanced'|'traditional'} [params.format] - Which layout to render.
 */
export async function exportReportCardPDF({ report, schoolData, format = 'enhanced' }) {
  const doc = await renderReportCardDoc({ report, schoolData, format })
  doc.save(`Report_Card_${safeName(report.student_name, 'Student')}.pdf`)
}

/**
 * Generates one report card PDF per student and downloads them together as a single
 * ZIP. Runs entirely client-side, sequentially (one student at a time), so it reuses
 * the exact same fetch -> render pipeline as the single-card download and doesn't
 * flood the API/Supabase storage with parallel requests for marks and photos.
 *
 * @param {Object} params
 * @param {Array<{studentId: number|string, name: string, roll: string}>} params.students
 * @param {string|number} params.yearId
 * @param {Array<string>} params.examIds
 * @param {Object} params.schoolData
 * @param {'enhanced'|'traditional'} [params.format]
 * @param {string} [params.className] - Used in the ZIP filename only.
 * @param {(done: number, total: number) => void} [params.onProgress]
 * @returns {Promise<{generated: number, skipped: Array<{name: string, reason: string}>}>}
 */
export async function exportBulkReportCardsZIP({
  students, yearId, examIds, schoolData, format = 'enhanced', className, onProgress,
}) {
  const zip = new JSZip()
  const logoCache = {}
  const skipped = []
  let generated = 0

  for (let i = 0; i < students.length; i++) {
    const student = students[i]
    try {
      const res = await examinationsApi.getReportCard({
        student_id: student.studentId,
        academic_year_id: yearId,
        exam_ids: examIds.join(','),
      })
      const report = res?.data
      if (!report) {
        skipped.push({ name: student.name, reason: 'No report card data' })
      } else {
        const doc = await renderReportCardDoc({ report, schoolData, format, logoCache })
        const blob = doc.output('blob')
        const fileName = `${safeName(student.roll, i + 1)}_${safeName(student.name, 'Student')}.pdf`
        zip.file(fileName, blob)
        generated += 1
      }
    } catch (err) {
      skipped.push({
        name: student.name,
        reason: err.response?.data?.detail || 'Could not generate this report card',
      })
    }
    onProgress?.(i + 1, students.length)
  }

  if (generated > 0) {
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(zipBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Report_Cards_${safeName(className, 'Class')}.zip`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  return { generated, skipped }
}
