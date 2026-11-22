import { questionPaperApi, worksheetApi } from '../../../services/api'

// Papers and worksheets share one block editor and one server path (paper_document.py, Paper Builder v2
// Phase 6b). Only the endpoints, the words and the header defaults differ, so the editor asks this for them.
const KINDS = {
  paper: {
    noun: 'paper',
    getDocument: questionPaperApi.getPaperDocument,
    saveDocument: questionPaperApi.saveDocument,
    previewDocument: questionPaperApi.previewDocument,
    getPrintHtml: questionPaperApi.getPrintHtml,
    getAnswerKeyHtml: questionPaperApi.getAnswerKeyHtml,
    generateDOCX: questionPaperApi.generateDOCX,
    // A paper prints its office table and its time/marks line unless the teacher turns them off.
    headerDefaultOn: true,
  },
  worksheet: {
    noun: 'worksheet',
    getDocument: worksheetApi.getDocument,
    saveDocument: worksheetApi.saveDocument,
    previewDocument: worksheetApi.previewDocument,
    getPrintHtml: worksheetApi.getPrintHtml,
    getAnswerKeyHtml: worksheetApi.getAnswerKeyHtml,
    generateDOCX: worksheetApi.generateDOCX,
    // Practice, not an exam: no office table or total unless the teacher turns them on.
    headerDefaultOn: false,
  },
}

export function documentApi(kind = 'paper') {
  return KINDS[kind] || KINDS.paper
}

/** Whether a header switch is on, given what the teacher set (or did not set) and the kind's default. */
export function headerSwitchOn(header, name, kind = 'paper') {
  const value = (header || {})[name]
  return documentApi(kind).headerDefaultOn ? value !== false : value === true
}
