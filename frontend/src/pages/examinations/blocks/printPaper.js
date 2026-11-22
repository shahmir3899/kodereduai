import { documentApi } from './documentApi'

// Block papers are printed on the device (decision 2026-11-15, docs/PAPER_BUILDER_V2_PLAN.md): the
// server sends the paper as one HTML page and the browser's own print dialog makes the PDF, so Urdu
// shaping and page layout are the browser's. The page is our own server output (teacher text already
// cleaned there), so it is printed from an unsandboxed off-screen frame: a sandboxed frame cannot be
// asked to print by this page.

export function printHtml(html, title = 'Paper') {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.title = title
    // A4 size off screen, so the page lays out as it will print.
    Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '210mm', height: '297mm', border: '0' })
    let done = false
    const cleanUp = () => {
      if (done) return
      done = true
      setTimeout(() => frame.remove(), 1000)
      resolve()
    }
    frame.onload = () => {
      // Give the maths script and linked pictures a moment after load.
      setTimeout(() => {
        try {
          frame.contentWindow.addEventListener('afterprint', cleanUp)
          frame.contentWindow.focus()
          frame.contentWindow.print()
        } finally {
          setTimeout(cleanUp, 60000)
        }
      }, 600)
    }
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}

// kind: 'paper' or 'worksheet' (documentApi.js).
export async function printPaper(paperId, title, kind = 'paper') {
  const response = await documentApi(kind).getPrintHtml(paperId)
  await printHtml(response.data, title)
}

// The answer key (step 7b): a short sheet of answers for the teacher, printed the same way as the paper.
export async function printAnswerKey(paperId, title, kind = 'paper') {
  const response = await documentApi(kind).getAnswerKeyHtml(paperId)
  await printHtml(response.data, `${title || kind} - answer key`)
}

export async function downloadPaperWord(paperId, title, kind = 'paper') {
  const response = await documentApi(kind).generateDOCX(paperId)
  const url = URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url
  link.download = `${(title || kind).replace(/[\\/:*?"<>|]+/g, ' ').trim() || kind}.docx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
