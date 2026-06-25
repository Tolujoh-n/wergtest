/**
 * Rough potential payout if the picked outcome wins (preview only).
 */

/** Map stored prediction outcome to boost-stats bucket key (match: TeamA/Draw/TeamB). */
export function boostOutcomeStatsKey(outcome, item, isPoll = false) {
  const o = String(outcome || '').trim();
  if (!o) return o;
  if (isPoll) {
    if (item?.optionType === 'options' && Array.isArray(item?.options)) {
      const hit = item.options.find(
        (opt) => String(opt?.text || '').trim().toLowerCase() === o.toLowerCase()
      );
      if (hit) return String(hit.text).trim();
    }
    const up = o.toUpperCase();
    if (up === 'YES' || up === 'NO') return up;
    return o;
  }
  const teamA = String(item?.teamA || '').trim();
  const teamB = String(item?.teamB || '').trim();
  const lower = o.toLowerCase();
  if (o === 'TeamA' || lower === 'teama' || (teamA && lower === teamA.toLowerCase())) return 'TeamA';
  if (o === 'TeamB' || lower === 'teamb' || (teamB && lower === teamB.toLowerCase())) return 'TeamB';
  if (o === 'Draw' || lower === 'draw') return 'Draw';
  return o;
}

/** Canonical key for matching boost rows to UI options. */
export function canonicalBoostOutcomeKey(outcome, item, isPoll = false) {
  return boostOutcomeStatsKey(outcome, item, isPoll);
}

export function netBoostStakeAmount(pred) {
  const stake = Number(pred?.totalStake ?? pred?.amount ?? 0);
  return Number.isFinite(stake) && stake > 0 ? stake : 0;
}

/** Build map optionKey -> merged boost prediction for table display. */
export function buildBoostStakeByOutcomeMap(boostPredictions, item, isPoll = false) {
  const map = new Map();
  for (const pred of boostPredictions || []) {
    const key = canonicalBoostOutcomeKey(pred.outcome, item, isPoll);
    if (!key) continue;
    const stake = netBoostStakeAmount(pred);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...pred, totalStake: stake, amount: stake });
      continue;
    }
    const combined = stake + netBoostStakeAmount(existing);
    map.set(key, {
      ...existing,
      ...pred,
      totalStake: combined,
      amount: combined,
    });
  }
  return map;
}

export function estimateMarketOrderbookPotentialWin({
  direction,
  shares,
  price,
  feeRate = 0.1,
}) {
  const sz = Number(shares) || 0;
  const px = Number(price);
  if (!(sz > 0) || !Number.isFinite(px) || px <= 0) return null;
  const fr = Number.isFinite(feeRate) && feeRate >= 0 ? feeRate : 0;
  if (direction === 'buy') {
    // Each share pays $1 if the outcome wins — total payout includes stake + profit.
    return Math.max(0, sz);
  }
  const proceeds = sz * px * (1 - fr);
  return Math.max(0, proceeds);
}

function netStakeFromGross(gross, platformFeePct, jackpotFeePct) {
  const g = Number(gross) || 0;
  if (!(g > 0)) return 0;
  const platformFee = (g * (Number(platformFeePct) || 0)) / 100;
  const jpFee = (g * (Number(jackpotFeePct) || 0)) / 100;
  return Math.max(0, g - platformFee - jpFee);
}

/**
 * Boost winners split the full boostPool (net stakes + admin top-ups) by stake on the winning outcome.
 */
/** Free jackpot share if this pick wins (pool × your tickets / tickets on same outcome). */
export function estimateFreeJackpotPotentialWin({
  freeJackpotPoolUsdc = 0,
  userTickets = 1,
  outcomeTotalTickets = 0,
}) {
  const pool = Math.max(0, Number(freeJackpotPoolUsdc) || 0);
  const userT = Math.max(1, parseInt(userTickets, 10) || 1);
  const outcomeTotal = Math.max(userT, Number(outcomeTotalTickets) || 0);
  if (!(pool > 0)) return null;
  return pool * (userT / outcomeTotal);
}

export function estimateBoostPotentialWin({
  grossStakeUsdc,
  boostPoolUsdc = 0,
  existingNetStake = 0,
  winningOutcomeTotalStake = 0,
  platformFeePct = 10,
  jackpotFeePct = 0,
}) {
  const pool = Math.max(0, Number(boostPoolUsdc) || 0);
  const existing = Math.max(0, Number(existingNetStake) || 0);
  const netNew = netStakeFromGross(grossStakeUsdc, platformFeePct, jackpotFeePct);
  const userStake = existing + netNew;
  const outcomeTotal = Math.max(Number(winningOutcomeTotalStake) || 0, userStake);
  const projectedPool = pool + (Number(grossStakeUsdc) > 0 ? netNew : 0);
  if (userStake <= 0 || projectedPool <= 0 || outcomeTotal <= 0) return null;
  // Stake is already in the pool — winners split the full pool by net stake weight.
  return projectedPool * (userStake / outcomeTotal);
}
