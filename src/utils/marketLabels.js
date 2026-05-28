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
  let optLabel = optionKey;
  if (isPoll) {
    if (itemData.optionType === 'options' && Array.isArray(itemData.options)) {
      const hit = itemData.options.find((o) => String(o.text || '').trim() === optionKey);
      if (hit && hit.text) optLabel = hit.text;
    } else {
      const ok = optionKey.toUpperCase();
      if (ok === 'YES' || ok === 'NO') optLabel = ok;
    }
  } else {
    const lo = optionKey.toLowerCase();
    if (optionKey === 'TeamA' || lo === 'teama') optLabel = itemData.teamA || 'Team A';
    else if (optionKey === 'TeamB' || lo === 'teamb') optLabel = itemData.teamB || 'Team B';
    else if (optionKey === 'Draw' || lo === 'draw') optLabel = 'Draw';
  }
  if (tokenSide === 'YES' || tokenSide === 'NO') return `${optLabel} · ${tokenSide}`;
  return s;
}
