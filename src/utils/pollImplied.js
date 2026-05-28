import api from './api';

/** Option keys used by the orderbook (matches MatchDetail outcomeRows). */
export function getPollOptionKeys(poll) {
  if (!poll) return [];
  if (poll.optionType === 'options' && Array.isArray(poll.options) && poll.options.length > 0) {
    return poll.options.map((o) => String(o.text || '').trim()).filter(Boolean);
  }
  return ['YES', 'NO'];
}

/** Fallback when orderbook is empty: normalize starting yesPrice rows. */
export function impliedFromStartingPrices(poll) {
  const keys = getPollOptionKeys(poll);
  if (!keys.length) return {};
  const raw = {};
  const n = keys.length;
  for (const key of keys) {
    const row = (poll.startingPrices || []).find((r) => String(r.optionKey) === key);
    const yp = Number(row?.yesPrice);
    raw[key] =
      Number.isFinite(yp) && yp > 0 && yp < 1 ? Math.max(0.001, Math.min(0.999, yp)) : 1 / n;
  }
  const sum = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  const out = {};
  for (const k of Object.keys(raw)) out[k] = raw[k] / sum;
  return out;
}

/**
 * Fetch live implied probabilities for many polls (same backend logic as market detail).
 * @returns {Record<string, Record<string, number>>} marketId -> { optionKey: 0..1 }
 */
export async function fetchPollImpliedBatch(polls) {
  const unique = new Map();
  for (const poll of polls || []) {
    if (poll?.marketId == null) continue;
    const id = String(poll.marketId);
    if (unique.has(id)) continue;
    unique.set(id, {
      marketId: poll.marketId,
      optionKeys: getPollOptionKeys(poll),
      startingPrices: poll.startingPrices || [],
    });
  }
  const markets = [...unique.values()].filter((m) => m.optionKeys.length > 0);
  if (!markets.length) return {};

  try {
    const { data } = await api.post('/orderbook/implied/batch', { markets });
    return data?.byMarketId || {};
  } catch (e) {
    console.warn('[pollImplied] batch fetch failed', e?.message || e);
    return {};
  }
}

export function getPollImpliedMap(poll, impliedByMarketId) {
  const id = poll?.marketId != null ? String(poll.marketId) : null;
  const fromBook = id && impliedByMarketId?.[id] ? impliedByMarketId[id] : null;
  if (fromBook && Object.keys(fromBook).length > 0) return fromBook;
  return impliedFromStartingPrices(poll);
}

/** Rank poll options by implied % (desc), same ordering as market detail. */
export function rankPollOptionsByImplied(poll, impliedByMarketId, limit = 3) {
  const implied = getPollImpliedMap(poll, impliedByMarketId);
  const rows = (poll.options || []).map((opt) => {
    const key = String(opt.text || '').trim();
    const pct = (implied[key] ?? 0) * 100;
    return { ...opt, key, pct };
  });
  rows.sort((a, b) => b.pct - a.pct);
  return {
    top: rows.slice(0, limit),
    total: rows.length,
    hasMore: rows.length > limit,
  };
}
