// Shape of GET /api/schools/completion/ (web SchoolCompletionWidget): per enabled module, how many
// setup steps are done, each step with the web page that finishes it.
export interface SetupStep { name: string; completed: boolean; count: number; target: number; link: string }
export interface SetupModule { key: string; label: string; percentage: number; steps: SetupStep[] }
export interface SetupProgress { overall_percentage: number; total_steps: number; completed_steps: number; modules: SetupModule[] }

// Where a module's bar leads: its first unfinished step, or the first step once all are done (as the web).
export function nextStepLink(m: SetupModule): string | undefined {
  return (m.steps.find((s) => !s.completed) ?? m.steps[0])?.link;
}

// Unfinished steps with how far along each is, for the line under a bar.
export function missingSteps(m: SetupModule): string {
  return m.steps.filter((s) => !s.completed)
    .map((s) => (s.target > 1 ? `${s.name} (${s.count}/${s.target})` : s.name))
    .join(', ');
}

export function progressTone(pct: number): 'success' | 'info' | 'warning' {
  return pct >= 100 ? 'success' : pct >= 50 ? 'info' : 'warning';
}
