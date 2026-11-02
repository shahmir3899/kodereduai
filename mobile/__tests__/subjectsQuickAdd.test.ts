import { PRESET_SUBJECTS, buildBulkPayload, bulkResultText, missingPresets } from '../services/subjectsAdmin';

describe('missingPresets', () => {
  it('lists every preset when the school has none', () => {
    expect(missingPresets([])).toHaveLength(PRESET_SUBJECTS.length);
  });

  it('leaves out codes the school has, ignoring case and spaces, even for a switched-off subject', () => {
    const left = missingPresets([{ code: 'math' }, { code: ' ENG ' }]).map((p) => p.code);
    expect(left).not.toContain('MATH');
    expect(left).not.toContain('ENG');
    expect(left).toContain('URDU');
  });

  it('is empty when the school has them all', () => {
    expect(missingPresets(PRESET_SUBJECTS.map((p) => ({ code: p.code })))).toEqual([]);
  });
});

describe('buildBulkPayload', () => {
  it('sends the chosen presets as non-elective subjects', () => {
    expect(buildBulkPayload(['ART', 'PE'])).toEqual({
      subjects: [{ name: 'Art', code: 'ART', is_elective: false }, { name: 'Physical Education', code: 'PE', is_elective: false }],
    });
  });

  it('ignores codes that are not presets', () => {
    expect(buildBulkPayload(['NOPE']).subjects).toEqual([]);
  });
});

describe('bulkResultText', () => {
  it('says what was added and what already existed', () => {
    expect(bulkResultText({ created: 2, skipped: 0 })).toBe('Added 2 subjects.');
    expect(bulkResultText({ created: 1, skipped: 3 })).toBe('Added 1 subject (3 already existed).');
    expect(bulkResultText({ created: 0, skipped: 2 })).toBe('Nothing added: they already exist.');
    expect(bulkResultText(undefined)).toBe('Nothing was added.');
  });
});
