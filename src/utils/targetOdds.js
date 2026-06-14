/** Target outcome odds (%) — all outcomes sum to 100. Maps to startingPrices for the MM bot. */

export function clampPct(n) {
  return Math.max(0, Math.min(100, Number(n) || 0));
}

export function pctRowsFromStartingPrices(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const yesPrices = rows.map((r) => Math.max(0, Number(r.yesPrice) || 0));
  const sum = yesPrices.reduce((a, b) => a + b, 0) || 1;
  return rows.map((r, i) => ({
    optionKey: r.optionKey,
    pct: Math.round((yesPrices[i] / sum) * 10000) / 100,
    quoteVolumeUsdc: Number(r.quoteVolumeUsdc) || 200,
  }));
}

export function normalizePctRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const parsed = rows.map((r) => ({
    optionKey: r.optionKey,
    pct: clampPct(r.pct),
  }));
  const sum = parsed.reduce((s, r) => s + r.pct, 0);
  if (sum <= 0) {
    const even = 100 / parsed.length;
    return parsed.map((r) => ({ ...r, pct: Math.round(even * 100) / 100 }));
  }
  const scaled = parsed.map((r) => ({
    optionKey: r.optionKey,
    pct: (r.pct / sum) * 100,
  }));
  let running = 0;
  for (let i = 0; i < scaled.length - 1; i++) {
    scaled[i].pct = Math.round(scaled[i].pct * 100) / 100;
    running += scaled[i].pct;
  }
  if (scaled.length) {
    scaled[scaled.length - 1].pct = Math.round((100 - running) * 100) / 100;
  }
  return scaled;
}

export function evenPctSplit(optionKeys) {
  const keys = (optionKeys || []).filter(Boolean);
  if (!keys.length) return [];
  const base = Math.floor((100 / keys.length) * 100) / 100;
  const rows = keys.map((optionKey) => ({ optionKey, pct: base, quoteVolumeUsdc: 200 }));
  rows[rows.length - 1].pct = Math.round((100 - base * (keys.length - 1)) * 100) / 100;
  return rows;
}

/** When one outcome % changes, redistribute the delta across the others proportionally. */
export function updateOutcomePct(rows, optionKey, rawPct) {
  const newPct = clampPct(rawPct);
  const idx = rows.findIndex((r) => String(r.optionKey) === String(optionKey));
  if (idx < 0) return normalizePctRows(rows);

  const oldPct = Number(rows[idx].pct) || 0;
  const delta = newPct - oldPct;
  const others = rows.filter((_, i) => i !== idx);
  const othersSum = others.reduce((s, r) => s + (Number(r.pct) || 0), 0);

  const next = rows.map((r, i) => {
    if (i === idx) return { ...r, pct: newPct };
    if (!others.length) return r;
    if (othersSum <= 0) {
      const share = (100 - newPct) / others.length;
      return { ...r, pct: Math.max(0, share) };
    }
    const weight = (Number(r.pct) || 0) / othersSum;
    return { ...r, pct: Math.max(0, (Number(r.pct) || 0) - delta * weight) };
  });

  return normalizePctRows(next);
}

export function resolveBalanceOptionKey(rows, balanceOptionKey) {
  if (balanceOptionKey) return balanceOptionKey;
  if (!rows?.length) return null;
  return rows[rows.length - 1].optionKey;
}

/** Recompute the balance outcome so fixed outcomes + balance = 100%. */
export function recomputeBalancePct(rows, balanceOptionKey) {
  const balanceKey = resolveBalanceOptionKey(rows, balanceOptionKey);
  if (!balanceKey || !rows?.length) return rows;

  const fixedSum = rows
    .filter((r) => String(r.optionKey) !== String(balanceKey))
    .reduce((s, r) => s + (Number(r.pct) || 0), 0);

  const balancePct = Math.max(0, Math.round((100 - fixedSum) * 100) / 100);

  return rows.map((r) =>
    String(r.optionKey) === String(balanceKey) ? { ...r, pct: balancePct } : r
  );
}

/**
 * Edit one fixed outcome; only the balance outcome adjusts to keep total at 100%.
 * Match: balance = TeamB. Poll: balance = last option.
 */
export function updateOutcomePctWithBalance(rows, optionKey, rawPct, balanceOptionKey) {
  const balanceKey = resolveBalanceOptionKey(rows, balanceOptionKey);
  if (!balanceKey || !rows?.length) return rows;

  if (String(optionKey) === String(balanceKey)) {
    return recomputeBalancePct(rows, balanceKey);
  }

  const fixedSumOthers = rows
    .filter(
      (r) =>
        String(r.optionKey) !== String(balanceKey) &&
        String(r.optionKey) !== String(optionKey)
    )
    .reduce((s, r) => s + (Number(r.pct) || 0), 0);

  const maxAllowed = Math.max(0, 100 - fixedSumOthers);
  const newPct = clampPct(Math.min(Number(rawPct) || 0, maxAllowed));

  const next = rows.map((r) =>
    String(r.optionKey) === String(optionKey) ? { ...r, pct: newPct } : r
  );

  return recomputeBalancePct(next, balanceKey);
}

export function distributeEvenlyWithBalance(rows, balanceOptionKey) {
  const balanceKey = resolveBalanceOptionKey(rows, balanceOptionKey);
  if (!balanceKey || !rows?.length) return rows;

  const fixedCount = rows.filter((r) => String(r.optionKey) !== String(balanceKey)).length;
  if (fixedCount === 0) {
    return rows.map((r) => ({ ...r, pct: 100 }));
  }

  const per = Math.round((100 / rows.length) * 100) / 100;
  const next = rows.map((r) => {
    if (String(r.optionKey) === String(balanceKey)) return { ...r, pct: 0 };
    return { ...r, pct: per };
  });

  return recomputeBalancePct(next, balanceKey);
}

export function startingPricesFromPctRows(rows) {
  const normalized = normalizePctRows(rows);
  return normalized.map((r) => {
    const yes = Math.max(0.01, Math.min(0.99, r.pct / 100));
    const no = Math.max(0.01, Math.min(0.99, 1 - yes));
    return {
      optionKey: r.optionKey,
      yesPrice: Math.round(yes * 10000) / 10000,
      noPrice: Math.round(no * 10000) / 10000,
      quoteVolumeUsdc: Math.max(10, Number(r.quoteVolumeUsdc) || 200),
      yesQuoteVolumeUsdc: Math.max(5, (Number(r.quoteVolumeUsdc) || 200) / 2),
      noQuoteVolumeUsdc: Math.max(5, (Number(r.quoteVolumeUsdc) || 200) / 2),
    };
  });
}

export function pctTotal(rows) {
  return (rows || []).reduce((s, r) => s + (Number(r.pct) || 0), 0);
}

export function pctTotalOk(rows, tolerance = 0.5) {
  return Math.abs(pctTotal(rows) - 100) <= tolerance;
}
