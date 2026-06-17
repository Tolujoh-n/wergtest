/** Keep verified holds status when background refresh returns incomplete rows. */
export function mergeNftBonusRows(prev = [], next = []) {
  if (!Array.isArray(next) || !next.length) return Array.isArray(next) ? next : [];
  const prevById = new Map();
  for (const row of prev || []) {
    const key = String(row?.id || row?.contractAddress || '').toLowerCase();
    if (key) prevById.set(key, row);
  }
  return next.map((row) => {
    const key = String(row?.id || row?.contractAddress || '').toLowerCase();
    const old = key ? prevById.get(key) : null;
    if (!old) return row;
    const merged = { ...row };
    if (merged.holds == null && old.holds != null) merged.holds = old.holds;
    if (!merged.verifiedOnChain && old.verifiedOnChain) merged.verifiedOnChain = old.verifiedOnChain;
    if (merged.holdsOnConnectedOnly == null && old.holdsOnConnectedOnly != null) {
      merged.holdsOnConnectedOnly = old.holdsOnConnectedOnly;
    }
    return merged;
  });
}
