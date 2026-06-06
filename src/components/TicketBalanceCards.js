import React from 'react';

function TicketSkeleton({ className = '' }) {
  return (
    <span
      className={`inline-block h-6 w-8 rounded bg-slate-200 dark:bg-slate-600 animate-pulse align-middle ${className}`}
      aria-hidden
    />
  );
}

/** Daily / golden / total ticket summary cards. */
export function TicketBalanceCards({ user, balances, loading = false, compact = false }) {
  const pad = compact ? 'p-2.5' : 'p-3';
  const numClass = compact ? 'font-bold text-lg tabular-nums' : 'font-bold text-lg tabular-nums';

  const renderCount = (value) => {
    if (!user) return '—';
    if (loading) return <TicketSkeleton />;
    return value ?? 0;
  };

  return (
    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-2 ${compact ? 'text-sm' : ''}`}>
      <div className={`rounded-lg border border-slate-200 dark:border-slate-600 ${pad} bg-white dark:bg-gray-800`}>
        <div className="text-xs text-slate-500">Daily tickets</div>
        <div className={numClass}>{renderCount(balances?.normalTickets)}</div>
      </div>
      <div
        className={`rounded-lg border border-amber-200 dark:border-amber-800 ${pad} bg-amber-50/50 dark:bg-amber-950/20`}
      >
        <div className="text-xs text-slate-500">Golden</div>
        <div className={`${numClass} text-amber-800 dark:text-amber-200`}>
          {renderCount(balances?.goldenTickets)}
        </div>
      </div>
      <div
        className={`rounded-lg border border-emerald-200 dark:border-emerald-800 ${pad} bg-emerald-50/50 dark:bg-emerald-950/20`}
      >
        <div className="text-xs text-slate-500">Total available</div>
        <div className={`${numClass} text-emerald-800 dark:text-emerald-200`}>
          {renderCount(balances?.totalSpendable)}
        </div>
        {!loading && (balances?.nftBonusToday || 0) > 0 && (
          <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">
            +{balances.nftBonusToday} from NFT/FT holdings
          </div>
        )}
      </div>
    </div>
  );
}

export default TicketBalanceCards;
