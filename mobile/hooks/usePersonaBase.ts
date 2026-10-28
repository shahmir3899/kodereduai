import { useAuth } from '../contexts/AuthContext';

// Route prefix of the signed-in persona's group, so one screen can serve admin and teacher
// without hard-coding "/(admin)/..." and bouncing off the other group's role guard.
export function usePersonaBase(): string {
  const { persona } = useAuth();
  return `/(${persona})`;
}
