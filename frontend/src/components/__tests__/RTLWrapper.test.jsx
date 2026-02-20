import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import RTLWrapper, { isRTLLanguage } from '../RTLWrapper'

describe('RTLWrapper', () => {
  it('renders dir=rtl for Urdu (ur)', () => {
    const { container } = render(<RTLWrapper language="ur"><span>اردو</span></RTLWrapper>)
    expect(container.firstChild).toHaveAttribute('dir', 'rtl')
  })

  it('renders dir=rtl for Arabic (ar)', () => {
    const { container } = render(<RTLWrapper language="ar"><span>عربي</span></RTLWrapper>)
    expect(container.firstChild).toHaveAttribute('dir', 'rtl')
  })

  it('renders dir=rtl for Sindhi (sd)', () => {
    const { container } = render(<RTLWrapper language="sd"><span>سنڌي</span></RTLWrapper>)
    expect(container.firstChild).toHaveAttribute('dir', 'rtl')
  })

  it('renders dir=rtl for Pashto (ps)', () => {
    const { container } = render(<RTLWrapper language="ps"><span>پښتو</span></RTLWrapper>)
    expect(container.firstChild).toHaveAttribute('dir', 'rtl')
  })

  it('renders dir=ltr for English (en)', () => {
    const { container } = render(<RTLWrapper language="en"><span>Hello</span></RTLWrapper>)
    expect(container.firstChild).toHaveAttribute('dir', 'ltr')
    expect(container.firstChild.className).not.toContain('font-rtl')
  })

  it('renders dir=ltr for Punjabi (pa)', () => {
    const { container } = render(<RTLWrapper language="pa"><span>ਪੰਜਾਬੀ</span></RTLWrapper>)
    expect(container.firstChild).toHaveAttribute('dir', 'ltr')
  })

  it('renders children correctly', () => {
    render(<RTLWrapper language="en"><span data-testid="child">Hello World</span></RTLWrapper>)
    expect(screen.getByTestId('child')).toHaveTextContent('Hello World')
  })

  it('applies font-rtl class for RTL languages', () => {
    const { container } = render(<RTLWrapper language="ur"><span>Test</span></RTLWrapper>)
    expect(container.firstChild.className).toContain('font-rtl')
  })

  it('applies custom className', () => {
    const { container } = render(<RTLWrapper language="en" className="my-class"><span>Test</span></RTLWrapper>)
    expect(container.firstChild.className).toContain('my-class')
  })
})

describe('isRTLLanguage', () => {
  it('returns true for RTL language codes', () => {
    expect(isRTLLanguage('ur')).toBe(true)
    expect(isRTLLanguage('ar')).toBe(true)
    expect(isRTLLanguage('sd')).toBe(true)
    expect(isRTLLanguage('ps')).toBe(true)
  })

  it('returns false for non-RTL language codes', () => {
    expect(isRTLLanguage('en')).toBe(false)
    expect(isRTLLanguage('pa')).toBe(false)
    expect(isRTLLanguage('other')).toBe(false)
    expect(isRTLLanguage('')).toBe(false)
  })
})
