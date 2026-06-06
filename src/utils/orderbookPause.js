import { resolveOrderbookOptionLabel } from './marketLabels';

/** Mirror backend orderbook pause rules (new buys blocked; exits allowed). */

export function getOptionPauseFlags(ob, optionKey) {
  const list = ob?.pauseByOption || [];
  const row = list.find((r) => String(r.optionKey) === String(optionKey));
  return {
    pauseYes: !!row?.pauseYes,
    pauseNo: !!row?.pauseNo,
  };
}

export function isOptionSidePaused(ob, optionKey, side) {
  if (!ob) return false;
  const perOpt = optionKey ? getOptionPauseFlags(ob, optionKey) : { pauseYes: false, pauseNo: false };
  if (side === 'YES') {
    return !!(ob.pauseSideYes || ob.riskPausedYes || perOpt.pauseYes);
  }
  if (side === 'NO') {
    return !!(ob.pauseSideNo || ob.riskPausedNo || perOpt.pauseNo);
  }
  return false;
}

/** True when new buy orders should be blocked on this outcome side. */
export function isNewBuysPaused(ob, optionKey, side) {
  if (!ob) return false;
  if (ob.marketPaused || ob.riskPausedMarket) return true;
  return isOptionSidePaused(ob, optionKey, side);
}

/** User sells / close position always allowed unless match is admin-locked. */
export function canExitPositionSide() {
  return true;
}

function outcomeSideLabel(itemData, isPoll, optionKey, side) {
  const name = resolveOrderbookOptionLabel(itemData, isPoll, optionKey);
  if (name && side) return `${name} · ${side}`;
  return side || name || 'This side';
}

export function pauseLabel(ob, optionKey, side, opts = {}) {
  if (!isNewBuysPaused(ob, optionKey, side)) return null;
  const { itemData, isPoll } = opts;
  const label = outcomeSideLabel(itemData, isPoll, optionKey, side);
  if (ob?.riskPausedMarket || ob?.marketPaused) {
    return 'Market paused for new buys — you can still close positions';
  }
  const perOpt = getOptionPauseFlags(ob, optionKey);
  const risk = side === 'YES' ? ob?.riskPausedYes : ob?.riskPausedNo;
  if (risk) {
    return `${label} paused (treasury cap) — new buys blocked; closes still allowed`;
  }
  if (side === 'YES' && perOpt.pauseYes) {
    return `${label} paused — new buys blocked; closes still allowed`;
  }
  if (side === 'NO' && perOpt.pauseNo) {
    return `${label} paused — new buys blocked; closes still allowed`;
  }
  return `${label} paused for new buys — closes still allowed`;
}
