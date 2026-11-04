import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Editor } from '@tiptap/core'
import { createExtensions, isRTLLanguage, unwrapLanguage, wrapLanguage } from '../richEditorCore'

// rich-html.json is shared with the mobile app: its WebView bundle must produce the same HTML as this editor.
const fixtures = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../docs/paper-contract/rich-html.json'), 'utf8'))

describe('question text editor (web is the reference)', () => {
  it.each(fixtures.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    const ed = new Editor({ element: document.createElement('div'), extensions: createExtensions(), content: c.html })
    const html = ed.getHTML()
    ed.destroy()
    expect(html).toBe(c.expected)
  })

  it.each(fixtures.wrap.map((w) => [w.language, w]))('wraps and unwraps %s', (_l, w) => {
    expect(wrapLanguage(w.inner, w.language)).toBe(w.wrapped)
    expect(unwrapLanguage(w.wrapped)).toEqual({ language: w.language, inner: w.inner })
  })

  it('treats plain or missing text as English', () => {
    expect(unwrapLanguage('')).toEqual({ language: 'en', inner: '' })
    expect(unwrapLanguage('5 + 3 = ____')).toEqual({ language: 'en', inner: '5 + 3 = ____' })
    expect(isRTLLanguage('ur')).toBe(true)
    expect(isRTLLanguage('en')).toBe(false)
  })
})
