import React, { useState } from 'react';
import TurnstileWidget from './TurnstileWidget';

function LoadingSpinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/**
 * Minimal Turnstile block for login/signup modals.
 */
export default function AuthTurnstileSection({
  enabled,
  loading,
  siteKey,
  resetKey,
  onVerify,
  onExpire,
}) {
  const [widgetLoading, setWidgetLoading] = useState(true);

  if (loading) {
    return (
      <div className="mb-4 flex items-center justify-center gap-2 py-5 text-sm text-slate-500 dark:text-slate-400">
        <LoadingSpinner />
        <span>Security checks loading...</span>
      </div>
    );
  }

  if (!enabled) return null;

  return (
    <div className="relative mb-4 flex min-h-[72px] items-center justify-center py-1">
      {widgetLoading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <LoadingSpinner />
          <span>Security checks loading...</span>
        </div>
      ) : null}
      <TurnstileWidget
        siteKey={siteKey}
        resetKey={resetKey}
        onVerify={onVerify}
        onExpire={onExpire}
        onReady={() => setWidgetLoading(false)}
        className={`flex w-full justify-center ${widgetLoading ? 'invisible' : ''}`}
      />
    </div>
  );
}
