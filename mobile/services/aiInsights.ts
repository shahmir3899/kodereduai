// The "AI Insights" list on the dashboard: short, rule-based notices the server builds for the school
// (low attendance, overdue fees, pending leave...). Same endpoint the web home uses. Pure logic.

export interface Insight {
  type?: 'alert' | 'warning' | 'info' | string;
  module?: string | null;
  title: string;
  detail?: string | null;
  // A web path such as /finance/fees/collect; the phone maps it to its own screen when it has one.
  link?: string | null;
  action?: string | null;
}

export const INSIGHTS_SHOWN = 3;

export function insightTone(type: string | undefined): 'error' | 'warning' | 'info' {
  return type === 'alert' ? 'error' : type === 'warning' ? 'warning' : 'info';
}

// The server sends { insights: [...] }; anything else means there is nothing to show.
export function insightList(data: unknown): Insight[] {
  const list = (data as { insights?: unknown } | null | undefined)?.insights;
  return Array.isArray(list) ? (list as Insight[]).filter((i) => i && typeof i.title === 'string' && i.title.trim() !== '') : [];
}

export const visibleInsights = (list: Insight[], expanded: boolean) => (expanded ? list : list.slice(0, INSIGHTS_SHOWN));

export const insightsToggleLabel = (count: number, expanded: boolean): string | null =>
  count <= INSIGHTS_SHOWN ? null : expanded ? 'Show less' : `Show all (${count})`;

export const moduleLabel = (m: string | null | undefined) => (m ? m[0].toUpperCase() + m.slice(1) : '');
