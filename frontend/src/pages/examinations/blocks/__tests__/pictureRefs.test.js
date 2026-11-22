import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { describePicture, makerDefaults, picturesFromNames, setMakerValue } from '../pictureRefs'

// pictureRefs.js and blockDocument.js are copied to the phone app as they are (scripts/build-rich-editor.mjs), so they
// must stay free of imports; richEditorBundle.test.js checks the copies are up to date.
describe('pictureRefs', () => {
  it.each(['pictureRefs.js', 'blockDocument.js'])('%s imports nothing', (file) => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
  })

  it('names library, uploaded, drawn and old pictures', () => {
    const catalog = [{ name: 'apple', en: 'Apple', url: '/lib/apple/' }]
    expect(describePicture('apple', { catalog })).toEqual({ label: 'Apple', image: '/lib/apple/' })
    expect(describePicture('nope', { catalog })).toEqual({ label: 'nope', image: null })
    expect(describePicture({ upload: 2 })).toEqual({ label: 'Picture 2', image: null })
    expect(describePicture({ url: 'https://x/y.png' })).toEqual({ label: 'Picture from the old paper', image: 'https://x/y.png' })
    expect(describePicture({ make: 'shape', shape: 'circle' }).label).toBe('Drawn: shape (shape circle)')
    expect(describePicture(null)).toBeNull()
  })

  it('starts the Create tab with sensible values and drops emptied ones', () => {
    const maker = { kind: 'number_line', fields: { start: { type: 'number' }, end: { type: 'number' }, marks: { type: 'numbers', optional: true }, shape: { type: 'choice', choices: ['circle', 'square'] } } }
    expect(makerDefaults(maker)).toEqual({ start: 0, end: 10, shape: 'circle' })
    expect(setMakerValue({ start: 1, end: 5 }, 'end', Number.NaN)).toEqual({ start: 1 })
    expect(setMakerValue({}, 'label', 'Big')).toEqual({ label: 'Big' })
  })
})

describe('picturesFromNames (faster 4)', () => {
  const catalog = [
    { name: 'flower', en: 'Flower', ur: 'پھول' },
    { name: 'flower_pot', en: 'Flower pot' },
    { name: 'pencil', en: 'Pencil' },
  ]
  it('matches exact names only and keeps counts written before or after', () => {
    expect(picturesFromNames('Flower 2, 4 pencil, flower pot', catalog)).toEqual({
      found: [{ picture: 'flower', count: 2 }, { picture: 'pencil', count: 4 }, { picture: 'flower_pot' }],
      unknown: [],
    })
  })
  it('hands back unknown names instead of guessing', () => {
    expect(picturesFromNames('flow 3، پھول', catalog)).toEqual({ found: [{ picture: 'flower' }], unknown: ['flow'] })
    expect(picturesFromNames(' , ', catalog)).toEqual({ found: [], unknown: [] })
  })
})
