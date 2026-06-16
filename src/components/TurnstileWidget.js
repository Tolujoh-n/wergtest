import React, { useEffect, useRef } from 'react';

let turnstileScriptPromise = null;

function loadTurnstileScript() {
  if (typeof window !== 'undefined' && window.turnstile) {
    return Promise.resolve();
  }
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-turnstile="true"]');
    if (existing) {
      if (window.turnstile) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = 'true';
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

/**
 * Cloudflare Turnstile — renders once per resetKey; callbacks via refs (no re-mount loop).
 */
export default function TurnstileWidget({
  siteKey,
  onVerify,
  onExpire,
  onError,
  resetKey = 0,
  className = '',
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const onErrorRef = useRef(onError);

  onVerifyRef.current = onVerify;
  onExpireRef.current = onExpire;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!siteKey) return undefined;

    let cancelled = false;

    const mount = async () => {
      try {
        await loadTurnstileScript();
        if (cancelled || !containerRef.current || !window.turnstile) return;

        if (widgetIdRef.current != null) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            /* ignore */
          }
          widgetIdRef.current = null;
        }

        containerRef.current.innerHTML = '';

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'auto',
          size: 'normal',
          callback: (t) => onVerifyRef.current?.(t),
          'expired-callback': () => onExpireRef.current?.(),
          'error-callback': () => onErrorRef.current?.(),
        });
      } catch {
        if (!cancelled) onErrorRef.current?.();
      }
    };

    mount();

    return () => {
      cancelled = true;
      if (widgetIdRef.current != null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, resetKey]);

  if (!siteKey) return null;

  return (
    <div className={className}>
      <div
        ref={containerRef}
        className="min-h-[65px] w-full flex items-center justify-center [&>iframe]:max-w-full"
      />
    </div>
  );
}
