import React from 'react';
import { create, act } from 'react-test-renderer';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

// react-test-renderer wants this flag to treat updates as wrapped in act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ value, onValue }: { value: string; onValue: (v: string) => void }) {
  onValue(useDebouncedValue(value, 400));
  return null;
}

describe('useDebouncedValue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('only follows the value once it has been still for the delay', () => {
    let seen = '';
    const onValue = (v: string) => { seen = v; };
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<Probe value="a" onValue={onValue} />); });
    expect(seen).toBe('a');

    act(() => { renderer.update(<Probe value="ab" onValue={onValue} />); });
    act(() => { renderer.update(<Probe value="abc" onValue={onValue} />); });
    act(() => { jest.advanceTimersByTime(399); });
    expect(seen).toBe('a');

    act(() => { jest.advanceTimersByTime(1); });
    expect(seen).toBe('abc');
  });
});
