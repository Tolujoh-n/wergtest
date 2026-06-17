/**
 * Whether users can still place/modify predictions — admin status only (not scheduled lockedTime).
 */
export function isEventOpenForPlay(item) {
  if (!item) return false;
  if (item.isResolved === true) return false;
  const s = String(item.status || '').toLowerCase().trim();
  if (s === 'locked' || s === 'settled' || s === 'ended') return false;
  return true;
}
