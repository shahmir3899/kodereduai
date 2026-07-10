import { reportsApi } from '../services/api'

function saveBlobAsFile(data, contentType, filename) {
  const url = window.URL.createObjectURL(new Blob([data], { type: contentType }))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  link.parentNode.removeChild(link)
  window.URL.revokeObjectURL(url)
}

/**
 * Downloads a previously generated report by ID through the authenticated
 * axios instance and saves it via a blob URL. A plain <a href> or window.open()
 * to the download endpoint doesn't carry the Authorization header (it's a raw
 * browser navigation, not an XHR), so this must go through reportsApi.download.
 */
export async function downloadGeneratedReport(reportId, filename = 'report.pdf') {
  const response = await reportsApi.download(reportId)
  saveBlobAsFile(response.data, response.headers?.['content-type'] || 'application/pdf', filename)
}

/**
 * Generates a report synchronously (no background task, nothing persisted
 * server-side) and saves it immediately via a blob URL.
 * @param {{report_type: string, parameters?: object}} requestData
 */
export async function downloadInstantReport(requestData, filename = 'report.pdf') {
  const response = await reportsApi.generateInstant(requestData)
  saveBlobAsFile(response.data, response.headers?.['content-type'] || 'application/pdf', filename)
}
