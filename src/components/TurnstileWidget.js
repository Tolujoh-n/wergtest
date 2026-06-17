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
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
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
 * Cloudflare Turnstile — mounts once; reset via turnstile.reset() (no remove/remount loop).
 */
export default function TurnstileWidget({
  siteKey,
  onVerify,
  onExpire,
  onReady,
  resetKey = 0,
  className = '',
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  const onReadyRef = useRef(onReady);
  const mountedRef = useRef(false);

  onVerifyRef.current = onVerify;
  onExpireRef.current = onExpire;
  onReadyRef.current = onReady;

  // Initial render — once per siteKey + container mount
  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined;

    let cancelled = false;
    mountedRef.current = true;

    const mount = async () => {
      try {
        await loadTurnstileScript();
        if (cancelled || !containerRef.current || !window.turnstile) return;
        if (widgetIdRef.current != null) return;

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'auto',
          size: 'normal',
          callback: (t) => onVerifyRef.current?.(t),
          'expired-callback': () => onExpireRef.current?.(),
          'error-callback': () => {
            /* Turnstile retries internally — do not remount */
          },
        });
        onReadyRef.current?.();
      } catch {
        /* script load failed — parent loading state will clear */
      }
    };

    mount();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (widgetIdRef.current != null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  // Soft reset after failed login — no DOM teardown
  useEffect(() => {
    if (resetKey === 0 || widgetIdRef.current == null || !window.turnstile) return;
    try {
      window.turnstile.reset(widgetIdRef.current);
    } catch {
      /* ignore */
    }
  }, [resetKey]);

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
