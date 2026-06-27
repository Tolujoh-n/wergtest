/**
 * Auto-lock: true once the admin-scheduled lock time has been reached.
 * This locks the event on the user side without an on-chain transaction;
 * the admin can later set the real "locked" status (which signs a tx).
 */
export function isEventLockedByTime(item, now = Date.now()) {
  if (!item || !item.lockedTime) return false;
  const t = new Date(item.lockedTime).getTime();
  if (!Number.isFinite(t)) return false;
  return now >= t;
}

/**
 * Whether users can still place/modify predictions.
 * Closed when: resolved, admin status locked/settled/ended, OR scheduled lock time reached.
 */
export function isEventOpenForPlay(item, now = Date.now()) {
  if (!item) return false;
  if (item.isResolved === true) return false;
  const s = String(item.status || '').toLowerCase().trim();
  if (s === 'locked' || s === 'settled' || s === 'ended') return false;
  if (isEventLockedByTime(item, now)) return false;
  return true;
}

/** Effective status for display: "completed" when resolved; "locked" when lock time passes. */
export function effectiveEventStatus(item, now = Date.now()) {
  if (!item) return '';
  if (item.isResolved === true) return 'completed';
  const s = String(item.status || '').toLowerCase().trim();
  if (s === 'locked' || s === 'settled' || s === 'ended' || s === 'completed') return s;
  if (isEventLockedByTime(item, now)) return 'locked';
  return s;
}
