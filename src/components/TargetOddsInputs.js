import React from 'react';
import {
  pctTotal,
  pctTotalOk,
  normalizePctRows,
  updateOutcomePct,
  updateOutcomePctWithBalance,
  distributeEvenlyWithBalance,
  resolveBalanceOptionKey,
} from '../utils/targetOdds';

/**
 * Admin inputs for target outcome odds (%). All outcomes sum to 100%.
 * When balanceOptionKey is set, only that outcome auto-adjusts; others are edited freely.
 */
const TargetOddsInputs = ({ rows, onUpdateRows, getLabel, compact = false, balanceOptionKey = null }) => {
  const balanceKey = resolveBalanceOptionKey(rows, balanceOptionKey);
  const total = pctTotal(rows);
  const totalOk = pctTotalOk(rows);

  const distributeEvenly = () => {
    if (balanceKey) {
      onUpdateRows(distributeEvenlyWithBalance(rows, balanceKey));
    } else {
      onUpdateRows(normalizePctRows(rows.map((r) => ({ ...r, pct: 100 / rows.length }))));
    }
  };

  const handlePctChange = (optionKey, rawValue) => {
    if (balanceKey) {
      onUpdateRows(updateOutcomePctWithBalance(rows, optionKey, rawValue, balanceKey));
    } else {
      onUpdateRows(updateOutcomePct(rows, optionKey, rawValue));
    }
  };

  if (!rows?.length) {
    return <p className="text-xs text-gray-500">Add outcomes to set target odds.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Target odds for the market maker.
          {balanceKey ? (
            <>
              {' '}
              Edit outcomes freely —{' '}
              <span className="font-medium">{getLabel ? getLabel(balanceKey) : balanceKey}</span> adjusts to total 100%.
            </>
          ) : (
            ' Displayed market % follows live book mids; bot quotes toward these targets.'
          )}
        </p>
        <button
          type="button"
          onClick={distributeEvenly}
          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          Split evenly
        </button>
      </div>

      <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
        {rows.map((row) => {
          const yesMid = (Number(row.pct) || 0) / 100;
          const isBalance = balanceKey && String(row.optionKey) === String(balanceKey);
          return (
            <div
              key={row.optionKey}
              className={`rounded-lg border p-3 ${
                isBalance
                  ? 'border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40'
              }`}
            >
              <div className="text-sm font-medium text-gray-900 dark:text-white mb-2 truncate">
                {getLabel ? getLabel(row.optionKey) : row.optionKey}
                {isBalance ? (
                  <span className="text-xs font-normal text-blue-600 dark:text-blue-400 ml-1">(auto)</span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={row.pct ?? ''}
                  readOnly={isBalance}
                  onChange={(e) => handlePctChange(row.optionKey, e.target.value)}
                  className={`flex-1 px-2 py-1.5 rounded border text-sm ${
                    isBalance
                      ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 cursor-default'
                      : 'dark:bg-gray-700 dark:text-white'
                  }`}
                />
                <span className="text-sm text-gray-500 shrink-0">%</span>
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5">
                YES mid ≈ {yesMid.toFixed(2)} · NO ≈ {(1 - yesMid).toFixed(2)}
              </p>
            </div>
          );
        })}
      </div>

      <p
        className={`text-xs font-medium ${
          totalOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
        }`}
      >
        Total: {total.toFixed(1)}%
        {!totalOk && !balanceKey ? ' — will auto-normalize to 100% on save' : ''}
        {!totalOk && balanceKey ? ' — fixed outcomes exceed 100%; balance is 0%' : ''}
      </p>
    </div>
  );
};

export default TargetOddsInputs;
