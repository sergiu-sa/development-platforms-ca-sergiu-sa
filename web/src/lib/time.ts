/**
 * Built once. `toLocaleDateString` constructs one of these internally on every
 * call, which is the most expensive thing in this file - and the browse list
 * calls it once per row on every redraw.
 */
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

export function relativeTime(iso: string, now: Date = new Date()): string {
  // Whole minutes elapsed, not the nearest minute: Math.round(0.5) rounds up
  // to 1, which would push a story published 30 seconds ago out of "just
  // now" and into "1m ago".
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;

  return DAY_MONTH.format(new Date(iso));
}
