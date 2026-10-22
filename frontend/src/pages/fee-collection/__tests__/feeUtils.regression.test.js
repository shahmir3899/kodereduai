import { describe, expect, it } from 'vitest'
import { getPaymentClassKey } from '../feeUtils'

describe('feeUtils regression', () => {
  it('getPaymentClassKey preserves priority for session/class ids', () => {
    expect(getPaymentClassKey({ session_class_id: 5, class_name: 'Class 1 - A' })).toBe('session:5')
    expect(getPaymentClassKey({ session_class_label: 'Class 1 - A' })).toBe('session:Class 1 - A')
    expect(getPaymentClassKey({ class_name: 'Class 1' })).toBe('class:Class 1')
    expect(getPaymentClassKey({ class_obj_id: 10 })).toBe('id:10')
  })
})
