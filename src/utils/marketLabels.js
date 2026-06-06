/** Resolve internal optionKey (e.g. TeamA, Draw) to the admin-set display name. */
export function resolveOrderbookOptionLabel(itemData, isPoll, optionKey) {
  if (!optionKey) return '';
  const key = String(optionKey).trim();
  if (!itemData) return key;
  if (isPoll) {
    if (itemData.optionType === 'options' && Array.isArray(itemData.options)) {
      const hit = itemData.options.find((o) => String(o.text || '').trim() === key);
      if (hit?.text) return hit.text;
    }
    const up = key.toUpperCase();
    if (up === 'YES' || up === 'NO') return up;
    return key;
  }
  const lo = key.toLowerCase();
  if (key === 'TeamA' || lo === 'teama') return itemData.teamA || 'Team A';
  if (key === 'TeamB' || lo === 'teamb') return itemData.teamB || 'Team B';
  if (key === 'Draw' || lo === 'draw') return 'Draw';
  return key;
}

/**
 * Human label for market / orderbook outcomes: internal keys like `TeamB|YES`
 * become `${teamBName} · YES` using admin-set match or poll option names.
 */
export function formatMarketOrderbookOutcomeLabel(rawOutcome, itemData, isPoll) {
  if (!rawOutcome) return '';
  if (!itemData) return String(rawOutcome).trim();
  const s = String(rawOutcome).trim();
  const pipeIdx = s.indexOf('|');
  if (pipeIdx === -1) {
    if (isPoll) {
      if (itemData.optionType === 'options' && Array.isArray(itemData.options)) {
        const option = itemData.options.find((opt) => String(opt.text || '').trim() === s);
        if (option) return option.text;
      }
      const up = s.toUpperCase();
      if (up === 'YES' || up === 'NO') return up;
      return s;
    }
    const lo = s.toLowerCase();
    if (s === 'TeamA' || lo === 'teama') return itemData.teamA || 'Team A';
    if (s === 'TeamB' || lo === 'teamb') return itemData.teamB || 'Team B';
    if (s === 'Draw' || lo === 'draw') return 'Draw';
    return s;
  }
  const optionKey = s.slice(0, pipeIdx).trim();
  const tokenSide = s.slice(pipeIdx + 1).trim().toUpperCase();
  const optLabel = resolveOrderbookOptionLabel(itemData, isPoll, optionKey);
  if (tokenSide === 'YES' || tokenSide === 'NO') return `${optLabel} · ${tokenSide}`;
  return s;
}
