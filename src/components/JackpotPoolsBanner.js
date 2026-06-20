import React from 'react';
import { formatJackpotUsd } from '../utils/money';

/**
 * Free + boost jackpot pools — responsive two-column banner (2 decimal USD).
 */
export default function JackpotPoolsBanner({
  freeJackpot = 0,
  boostJackpot = 0,
  className = '',
  compact = false,
}) {
  const pad = compact ? 'p-3' : 'p-4';
  const valueClass = compact
    ? 'text-base sm:text-lg font-bold tabular-nums truncate'
    : 'text-lg sm:text-xl font-bold tabular-nums truncate';

  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-emerald-200/80 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-50/90 to-white dark:from-emerald-950/30 dark:to-gray-900/40 ${pad} ${className}`}
    >
      <div className="min-w-0 rounded-lg bg-white/70 dark:bg-gray-900/40 px-3 py-2.5 border border-emerald-100 dark:border-emerald-900/50">
        <div className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-0.5">
          Free jackpot
        </div>
        <div className={`${valueClass} text-emerald-800 dark:text-emerald-200`} title={formatJackpotUsd(freeJackpot)}>
          {formatJackpotUsd(freeJackpot)}
        </div>
      </div>
      <div className="min-w-0 rounded-lg bg-white/70 dark:bg-gray-900/40 px-3 py-2.5 border border-purple-100 dark:border-purple-900/50">
        <div className="text-[10px] sm:text-xs font-semibold uppercase tracking-wide text-purple-700 dark:text-purple-400 mb-0.5">
          Boost jackpot
        </div>
        <div className={`${valueClass} text-purple-800 dark:text-purple-200`} title={formatJackpotUsd(boostJackpot)}>
          {formatJackpotUsd(boostJackpot)}
        </div>
      </div>
    </div>
  );
}

export function jackpotPoolsFromItem(item) {
  if (!item) return { freeJackpot: 0, boostJackpot: 0 };
  const freeJackpot =
    item.isResolved && item.originalFreeJackpotPool != null
      ? Number(item.originalFreeJackpotPool) || 0
      : Number(item.freeJackpotPool) || 0;
  const boostJackpot =
    item.isResolved && (item.originalBoostPool ?? 0) > 0
      ? Number(item.originalBoostPool) || 0
      : Number(item.boostPool) || 0;
  return { freeJackpot, boostJackpot };
}
