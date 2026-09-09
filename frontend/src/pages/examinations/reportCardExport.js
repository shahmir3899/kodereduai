import jsPDF from 'jspdf'
import { buildReportData } from './reportCardData'
import { renderEnhanced } from './reportCardTemplates/enhanced'
import { renderTraditional } from './reportCardTemplates/traditional'

const RENDERERS = {
  enhanced: renderEnhanced,
  traditional: renderTraditional,
}

/**
 * Generate and download a Report Card PDF.
 * @param {Object} params
 * @param {Object} params.report - Report card data from api.getReportCard()
 * @param {Object} params.schoolData - School details from schoolsApi.getMySchool()
 * @param {'enhanced'|'traditional'} [params.format] - Which layout to render.
 */
export async function exportReportCardPDF({ report, schoolData, format = 'enhanced' }) {
  const render = RENDERERS[format] || RENDERERS.enhanced
  const data = await buildReportData({ report, schoolData })

  const doc = new jsPDF()
  render(doc, data)

  const safeName = (report.student_name || 'Student').replace(/[^a-zA-Z0-9]/g, '_')
  doc.save(`Report_Card_${safeName}.pdf`)
}
