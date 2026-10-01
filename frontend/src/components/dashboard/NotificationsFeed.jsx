import NotificationCarousel from '../notifications/NotificationCarousel'

// Kept as the dashboards' import point so the eight role dashboards need no
// changes; the `limit` prop they pass is obsolete because the carousel pages itself.
export default function NotificationsFeed() {
  return <NotificationCarousel />
}
