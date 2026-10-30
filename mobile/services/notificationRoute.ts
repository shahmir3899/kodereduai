import { homeRouteFor, type Persona } from '../navigation/personas';
import { routeFor } from '../navigation/routes';

// Where a tapped push notification should open. The backend sends only `log_id` today (no
// `screen`), so the default is the persona's notifications inbox. A `screen` is honoured only when
// it stays inside the signed-in persona's own route group, so a payload can never push a driver
// into the admin shell (the role guard would bounce it anyway).
export function notificationTapRoute(persona: Persona, data: Record<string, unknown> | null | undefined): string {
  const screen = data?.screen;
  if (typeof screen === 'string' && screen.startsWith(`/(${persona})/`)) return screen;
  // A persona with no inbox screen would land on its home.
  return routeFor(persona, '/notifications') ?? homeRouteFor(persona);
}
