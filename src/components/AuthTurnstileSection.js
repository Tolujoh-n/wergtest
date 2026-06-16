import React from 'react';
import TurnstileWidget from './TurnstileWidget';

/**
 * Security check block shown at top of login/signup modals when Turnstile is enabled.
 */
export default function AuthTurnstileSection({
  enabled,
  loading,
  verified,
  siteKey,
  resetKey,
  onVerify,
  onExpire,
  onClear,
}) {
  if (loading) {
    return (
      <div className="mb-4 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-xs text-slate-500">
        Loading security check…
      </div>
    );
  }

  if (!enabled) return null;

  return (
    <div
      className={`mb-4 rounded-xl border px-3 py-3 transition-colors ${
        verified
          ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-950/30'
          : 'border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Security check
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {verified
              ? 'Verified — you can log in, sign up, or connect your wallet.'
              : 'Complete this check before logging in, signing up, or connecting a wallet.'}
          </p>
        </div>
        {verified ? (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5">
            ✓ OK
          </span>
        ) : null}
      </div>
      <TurnstileWidget
        siteKey={siteKey}
        resetKey={resetKey}
        onVerify={onVerify}
        onExpire={onExpire}
        onError={onClear}
        className="flex justify-center"
      />
    </div>
  );
}
