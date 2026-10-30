// Kept free of React/Expo imports so the sequencing can be unit-tested.

export interface SchoolSwitchDeps {
  // Server-side access check; rejects (403/404) when the user may not use that school.
  checkAccess: (schoolId: number) => Promise<unknown>;
  getSavedSchoolId: () => Promise<string | null>;
  saveSchoolId: (id: string) => Promise<void>;
  // Re-reads /api/auth/me/ and resolves the active school from the saved id.
  refreshUser: () => Promise<unknown>;
}

// Order matters: the access check runs before anything is stored, and the saved id is rolled
// back if the refresh fails, so a failed switch leaves the user on the school they were in.
export async function performSchoolSwitch(schoolId: number, deps: SchoolSwitchDeps): Promise<void> {
  await deps.checkAccess(schoolId);
  const previousId = await deps.getSavedSchoolId();
  await deps.saveSchoolId(String(schoolId));
  try {
    await deps.refreshUser();
  } catch (error) {
    if (previousId) await deps.saveSchoolId(previousId);
    throw error;
  }
}
