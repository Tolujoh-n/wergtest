/**
 * Rough potential payout if the picked outcome wins (preview only).
 */

/** Map stored prediction outcome to boost-stats bucket key (match: TeamA/Draw/TeamB). */
export function boostOutcomeStatsKey(outcome, item, isPoll = false) {
  const o = String(outcome || '').trim();
  if (!o) return o;
  if (isPoll) return o;
  const teamA = String(item?.teamA || '').trim();
  const teamB = String(item?.teamB || '').trim();
  const lower = o.toLowerCase();
  if (o === 'TeamA' || lower === 'teama' || (teamA && lower === teamA.toLowerCase())) return 'TeamA';
  if (o === 'TeamB' || lower === 'teamb' || (teamB && lower === teamB.toLowerCase())) return 'TeamB';
  if (o === 'Draw' || lower === 'draw') return 'Draw';
  return o;
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
    const cost = sz * px * (1 + fr);
    const payoutIfWin = sz;
    return Math.max(0, payoutIfWin - cost);
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
  const outcomeTotal = Math.max(
    Number(winningOutcomeTotalStake) || 0,
    userStake
  );
  if (userStake <= 0 || pool <= 0 || outcomeTotal <= 0) return null;
  return pool * (userStake / outcomeTotal);
}
