// @vitest-environment node
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { JSDOM } from 'jsdom'
import { RICH_EDITOR_HTML } from '../../../../mobile/assets/richEditorHtml'
import { wrapLanguage } from '../richEditorCore'

// The page the phone shows (built from richEditorCore.js) must write the same HTML as the web editor, and must be
// rebuilt whenever richEditorCore.js changes.
const fixtures = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../docs/paper-contract/rich-html.json'), 'utf8'))
const root = path.resolve(__dirname, '../../../..')

function openPage() {
  const sent = []
  const dom = new JSDOM(RICH_EDITOR_HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.ReactNativeWebView = { postMessage: (s) => sent.push(JSON.parse(s)) }
      window.ResizeObserver = class { observe() {} disconnect() {} }
    },
  })
  const send = (msg) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: JSON.stringify(msg) }))
  return { dom, sent, send }
}

describe('mobile editor page', () => {
  it('is up to date with richEditorCore.js', () => {
    expect(() => execFileSync('node', ['scripts/build-rich-editor.mjs', '--check'], { cwd: root, stdio: 'pipe' })).not.toThrow()
  })

  it('announces itself when loaded', () => {
    const { sent } = openPage()
    expect(sent[0]).toEqual({ type: 'ready' })
  })

  it.each(fixtures.cases.map((c) => [c.name, c]))('writes the same HTML as web for %s', (_name, c) => {
    const { sent, send } = openPage()
    send({ type: 'init', html: c.html, placeholder: '' })
    send({ type: 'lang', code: 'en' }) // asks the page to report its current HTML
    const change = sent.filter((m) => m.type === 'change').pop()
    expect(change.html).toBe(wrapLanguage(c.expected, 'en'))
  })

  it('keeps and switches the language of a wrapped question', () => {
    const { sent, send } = openPage()
    send({ type: 'init', html: '<div dir="rtl" lang="ur" class="font-rtl"><p>پانی</p></div>' })
    send({ type: 'cmd', name: 'bold' })
    send({ type: 'lang', code: 'ur' })
    expect(sent.filter((m) => m.type === 'change').pop().html).toBe('<div dir="rtl" lang="ur" class="font-rtl"><p>پانی</p></div>')
    send({ type: 'lang', code: 'en' })
    expect(sent.filter((m) => m.type === 'change').pop().html).toBe('<div dir="ltr" lang="en" class=""><p>پانی</p></div>')
  })

  it('applies toolbar commands and reports them', () => {
    const { sent, send } = openPage()
    send({ type: 'init', html: '<p>word</p>' })
    send({ type: 'cmd', name: 'selectAll' }) // unknown commands are ignored
    send({ type: 'cmd', name: 'insertTable' })
    send({ type: 'lang', code: 'en' })
    const change = sent.filter((m) => m.type === 'change').pop()
    expect(change.html).toContain('<table')
    expect(change.blank).toBe(false)
    expect(sent.filter((m) => m.type === 'state').pop().active.inTable).toBe(true)
  })

  it('reports an empty editor as blank', () => {
    const { sent, send } = openPage()
    send({ type: 'init', html: '' })
    send({ type: 'lang', code: 'en' })
    expect(sent.filter((m) => m.type === 'change').pop().blank).toBe(true)
  })
})
