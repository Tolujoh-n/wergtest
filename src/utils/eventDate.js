/** Treat datetime-local value as UTC (GMT) wall time — what admin sets is what we store. */
export function utcDatetimeLocalToIso(localStr) {
  if (!localStr || !String(localStr).trim()) return null;
  const [datePart, timePart] = String(localStr).trim().split('T');
  if (!datePart || !timePart) return null;
  const iso = `${datePart}T${timePart}:00.000Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Format stored UTC date for datetime-local input (GMT wall time). */
export function utcIsoToDatetimeLocal(isoOrDate) {
  if (!isoOrDate) return '';
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Display e.g. "23 Jun 2026, 01:13 GMT". */
export function formatEventDateGmt(isoOrDate) {
  if (!isoOrDate) return '';
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} GMT`;
}
