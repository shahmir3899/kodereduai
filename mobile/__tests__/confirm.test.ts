import { Alert, Platform } from 'react-native';
import { confirm } from '../components/ui/confirm';

describe('confirm', () => {
  const realOS = Platform.OS;
  afterEach(() => { (Platform as { OS: string }).OS = realOS; jest.restoreAllMocks(); });

  it('on a phone shows an alert and settles with the button pressed', async () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[1].onPress?.(); });
    await expect(confirm({ title: 'Delete?', message: 'Gone for good', confirmLabel: 'Delete' })).resolves.toBe(true);
    expect(spy.mock.calls[0][0]).toBe('Delete?');
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[0].onPress?.(); });
    await expect(confirm({ title: 'Delete?' })).resolves.toBe(false);
  });

  it('in a browser uses the page confirm box and does not stall', async () => {
    (Platform as { OS: string }).OS = 'web';
    const box = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    (globalThis as { window?: unknown }).window = { confirm: box };
    await expect(confirm({ title: 'Marks mismatch', message: 'Continue anyway?' })).resolves.toBe(true);
    expect(box).toHaveBeenCalledWith('Marks mismatch\n\nContinue anyway?');
    await expect(confirm({ title: 'Only a title' })).resolves.toBe(false);
    expect(box).toHaveBeenLastCalledWith('Only a title');
    delete (globalThis as { window?: unknown }).window;
  });
});
