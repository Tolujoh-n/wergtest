export function formatUsdAmount(amount, { maximumFractionDigits = 4 } = {}) {
  const n = typeof amount === 'string' ? parseFloat(amount) : Number(amount);
  if (!Number.isFinite(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(n);
}

/** Jackpot / pool display — always 2 decimal places, full figure visible via tabular-nums + title. */
export function formatJackpotUsd(amount) {
  return formatUsdAmount(amount, { maximumFractionDigits: 2 });
}

