import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// A list/dashboard page must not pull the export libraries (jsPDF, autotable, html2canvas, xlsx,
// ~0.6-1 MB raw) just by opening: they load on the export/upload click. This guards the imports,
// because a stray static import would silently put the weight back on every visit.
const read = (rel) => readFileSync(resolve(__dirname, '..', rel), 'utf8')

const PAGES = {
  'StudentsPage.jsx': ['./studentExport'],
  'FinanceDashboardPage.jsx': ['./finance/financeReportExport'],
  'fee-collection/FeeCollectPage.jsx': ['./feeExport'],
  'lms/LessonPlansPage.jsx': ['./lessonPlansExportPdf'],
  'examinations/ReportCardPage.jsx': ['./reportCardExport'],
  'examinations/MarksEntryPage.jsx': ['xlsx'],
}

const staticImportOf = (src, mod) =>
  new RegExp(`^\s*import\s[^\n]*from\s+['"]${mod.replace(/[.*+?^${}()|[\]\/]/g, '\$&')}['"]`, 'm').test(src)

describe('export libraries are loaded on demand', () => {
  for (const [page, mods] of Object.entries(PAGES)) {
    for (const mod of mods) {
      it(`${page} has no static import of ${mod} but imports it lazily`, () => {
        const src = read(page)
        expect(staticImportOf(src, mod)).toBe(false)
        expect(src).toContain(`import('${mod}')`)
      })
    }
  }

  it.each(['jspdf', 'jspdf-autotable', 'html2canvas', 'xlsx'])('no page file imports %s statically', (lib) => {
    for (const page of Object.keys(PAGES)) {
      expect(staticImportOf(read(page), lib)).toBe(false)
    }
  })
})
