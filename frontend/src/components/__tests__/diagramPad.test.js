// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { DIAGRAM_PAD_HTML } from '../../../../mobile/assets/diagramPadHtml'
import { CANVAS_HEIGHT, CANVAS_WIDTH, COLORS, drawAction, redraw, TOOL_IDS, WEIGHTS } from '../diagramDraw'

// The drawing page the phone shows (built from diagramDraw.js + diagramEntry.js), driven with the app's messages.
function openPad() {
  const sent = []
  const calls = []
  const ctx = new Proxy({}, { get: (_t, name) => (...args) => { calls.push([String(name), ...args]) }, set: (_t, name, value) => { calls.push(['set:' + String(name), value]); return true } })
  const dom = new JSDOM(DIAGRAM_PAD_HTML, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(window) {
      window.ReactNativeWebView = { postMessage: (s) => sent.push(JSON.parse(s)) }
      window.HTMLCanvasElement.prototype.getContext = () => ctx
      window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,QUJD'
      window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT })
    },
  })
  const win = dom.window
  const send = (msg) => win.dispatchEvent(new win.MessageEvent('message', { data: JSON.stringify(msg) }))
  const pointer = (type, x, y) => win.document.getElementById('pad').dispatchEvent(new win.MouseEvent(type, { clientX: x, clientY: y, bubbles: true }))
  const last = (type) => sent.filter((m) => m.type === type).pop()
  return { sent, calls, send, pointer, last, canvas: win.document.getElementById('pad') }
}

describe('drawing pad page', () => {
  it('is the web canvas size and announces itself', () => {
    const { sent, canvas, last } = openPad()
    expect(sent[0]).toEqual({ type: 'ready' })
    expect([canvas.width, canvas.height]).toEqual([CANVAS_WIDTH, CANVAS_HEIGHT])
    expect(last('state')).toMatchObject({ tool: 'pen', color: COLORS[0], weight: WEIGHTS[1], canUndo: false, canRedo: false, empty: true })
  })

  it('draws a line, then undoes, redoes and clears it', () => {
    const { send, pointer, last, calls } = openPad()
    send({ type: 'tool', id: 'line' })
    pointer('pointerdown', 10, 20); pointer('pointermove', 100, 120); pointer('pointerup', 100, 120)
    expect(last('state')).toMatchObject({ tool: 'line', canUndo: true, canRedo: false, empty: false })
    expect(calls.some((c) => c[0] === 'lineTo' && c[1] === 100 && c[2] === 120)).toBe(true)
    send({ type: 'undo' })
    expect(last('state')).toMatchObject({ canUndo: false, canRedo: true, empty: true })
    send({ type: 'redo' })
    expect(last('state')).toMatchObject({ canUndo: true, canRedo: false })
    send({ type: 'clear' })
    expect(last('state')).toMatchObject({ canUndo: false, canRedo: false, empty: true })
  })

  it('draws freehand with the chosen colour and weight, and erases in white', () => {
    const { send, pointer, calls } = openPad()
    send({ type: 'color', value: COLORS[1] }); send({ type: 'weight', value: WEIGHTS[2] })
    pointer('pointerdown', 5, 5); pointer('pointermove', 30, 30); pointer('pointerup', 30, 30)
    expect(calls).toContainEqual(['set:strokeStyle', COLORS[1]])
    expect(calls).toContainEqual(['set:lineWidth', WEIGHTS[2]])
    send({ type: 'tool', id: 'eraser' })
    pointer('pointerdown', 6, 6); pointer('pointermove', 20, 20); pointer('pointerup', 20, 20)
    expect(calls).toContainEqual(['set:strokeStyle', '#ffffff'])
    expect(calls).toContainEqual(['set:lineWidth', WEIGHTS[2] * 4])
  })

  it('asks the app for the words of a text label, then places it', () => {
    const { send, pointer, last, sent } = openPad()
    send({ type: 'tool', id: 'text' })
    pointer('pointerdown', 40, 50)
    expect(sent.some((m) => m.type === 'needText')).toBe(true)
    expect(last('state').empty).toBe(true)
    send({ type: 'text', value: '  A  ' })
    expect(last('state')).toMatchObject({ canUndo: true, empty: false })
  })

  it('exports the drawing as a PNG data URL', () => {
    const { send, last } = openPad()
    send({ type: 'export' })
    expect(last('png')).toEqual({ type: 'png', data: 'data:image/png;base64,QUJD' })
  })

  it('ignores unknown tools, colours and messages', () => {
    const { send, last } = openPad()
    send({ type: 'tool', id: 'laser' }); send({ type: 'color', value: '#123456' }); send({ type: 'weight', value: 99 })
    expect(last('state')).toMatchObject({ tool: 'pen', color: COLORS[0], weight: WEIGHTS[1] })
    expect(() => send({ type: 'nope' })).not.toThrow()
  })
})

describe('diagramDraw (shared with the web canvas)', () => {
  it('knows the tools the web offers', () => {
    expect(TOOL_IDS).toEqual(['pen', 'line', 'rect', 'circle', 'ellipse', 'triangle', 'arrow', 'text', 'eraser'])
  })
  it('paints a white page and then each action', () => {
    const calls = []
    const ctx = new Proxy({}, { get: (_t, name) => (...a) => { calls.push([String(name), ...a]) }, set: () => true })
    redraw(ctx, [{ type: 'line', x1: 0, y1: 0, x2: 5, y2: 5, color: '#000', width: 2 }], null)
    expect(calls[0]).toEqual(['clearRect', 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT])
    expect(calls.some((c) => c[0] === 'fillRect')).toBe(true)
    expect(calls.some((c) => c[0] === 'lineTo' && c[1] === 5)).toBe(true)
    expect(() => drawAction(ctx, { type: 'unknown', color: '#000', width: 1 })).not.toThrow()
  })
})
