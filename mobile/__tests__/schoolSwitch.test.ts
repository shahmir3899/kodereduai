import { performSchoolSwitch, type SchoolSwitchDeps } from '../services/schoolSwitch';

function makeDeps(overrides: Partial<SchoolSwitchDeps> = {}, saved: { id: string | null } = { id: '1' }) {
  const calls: string[] = [];
  const deps: SchoolSwitchDeps = {
    checkAccess: jest.fn(async (id: number) => { calls.push(`check:${id}`); }),
    getSavedSchoolId: jest.fn(async () => saved.id),
    saveSchoolId: jest.fn(async (id: string) => { calls.push(`save:${id}`); saved.id = id; }),
    refreshUser: jest.fn(async () => { calls.push('refresh'); }),
    ...overrides,
  };
  return { deps, calls, saved };
}

describe('performSchoolSwitch', () => {
  it('checks access, stores the new id, then refreshes the user', async () => {
    const { deps, calls } = makeDeps();
    await performSchoolSwitch(2, deps);
    expect(calls).toEqual(['check:2', 'save:2', 'refresh']);
  });

  it('stores nothing when the server refuses the school', async () => {
    const { deps, saved } = makeDeps({ checkAccess: jest.fn(async () => { throw new Error('403'); }) });
    await expect(performSchoolSwitch(2, deps)).rejects.toThrow('403');
    expect(deps.saveSchoolId).not.toHaveBeenCalled();
    expect(saved.id).toBe('1');
  });

  it('puts the previous school back when the refresh fails', async () => {
    const { deps, saved } = makeDeps({ refreshUser: jest.fn(async () => { throw new Error('network'); }) });
    await expect(performSchoolSwitch(2, deps)).rejects.toThrow('network');
    expect(saved.id).toBe('1');
  });

  it('does not restore anything when there was no previous school', async () => {
    const { deps } = makeDeps(
      { refreshUser: jest.fn(async () => { throw new Error('network'); }) },
      { id: null },
    );
    await expect(performSchoolSwitch(2, deps)).rejects.toThrow('network');
    expect(deps.saveSchoolId).toHaveBeenCalledTimes(1);
  });
});
