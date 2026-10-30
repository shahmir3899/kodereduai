import { Colors } from '../constants/colors';
import { contrastRatio } from '../services/contrast';

// WCAG AA for normal text. Each row is a pair the UI kit really draws.
const AA = 4.5;
const pairs: Array<[string, string, string]> = [
  ['success pill', Colors.successText, Colors.successLight],
  ['warning pill', Colors.warningText, Colors.warningLight],
  ['error pill', Colors.errorText, Colors.errorLight],
  ['info pill', Colors.infoText, Colors.infoLight],
  ['neutral pill', Colors.neutralText, Colors.surfaceSecondary],
  ['purple badge', '#7c3aed', '#f3e8ff'],
  ['secondary text on card', Colors.textSecondary, Colors.surface],
  ['placeholder on card', Colors.placeholder, Colors.surface],
  ['inactive tab on bar', Colors.textTertiary, Colors.surface],
  ['placeholder on page', Colors.placeholder, Colors.background],
  ['primary button text', Colors.textInverse, Colors.primary],
  ['danger button text', Colors.textInverse, Colors.error],
  ['secondary button text', Colors.textInverse, Colors.secondary],
  ['outline button text', Colors.primary, Colors.surface],
];

describe('UI colour contrast', () => {
  it.each(pairs)('%s meets 4.5:1', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });
});
