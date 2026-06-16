import React, { useEffect, useRef, useState } from 'react';
import api from '../utils/api';

let turnstileScriptPromise = null;

function loadTurnstileScript() {
  if (typeof window !== 'undefined' && window.turnstile) {
    return Promise.resolve();
  }
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-turnstile="true"]');
    if (existing) {
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
 * Cloudflare Turnstile widget. Fetches site key from /config/security when not passed.
 */
export default function TurnstileWidget({
  siteKey: siteKeyProp,
  onVerify,
  onExpire,
  onError,
  resetKey = 0,
  className = '',
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [siteKey, setSiteKey] = useState(siteKeyProp || '');
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (siteKeyProp) {
      setSiteKey(siteKeyProp);
      return;
    }
    let cancelled = false;
    api
      .get('/config/security')
      .then(({ data }) => {
        if (!cancelled && data?.turnstileSiteKey) {
          setSiteKey(data.turnstileSiteKey);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [siteKeyProp]);

  useEffect(() => {
    if (!siteKey) return undefined;

    let cancelled = false;
    loadTurnstileScript()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Security check could not load.');
          onError?.();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [siteKey, onError]);

  useEffect(() => {
    if (!ready || !siteKey || !containerRef.current || !window.turnstile) return undefined;

    if (widgetIdRef.current != null) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {
        /* ignore */
      }
      widgetIdRef.current = null;
    }

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: 'auto',
      callback: (token) => onVerify?.(token),
      'expired-callback': () => onExpire?.(),
      'error-callback': () => {
        onError?.();
      },
    });

    return () => {
      if (widgetIdRef.current != null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null;
      }
    };
  }, [ready, siteKey, resetKey, onVerify, onExpire, onError]);

  if (!siteKey) return null;

  return (
    <div className={className}>
      <div ref={containerRef} className="min-h-[65px] flex items-center justify-center" />
      {loadError ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{loadError}</p>
      ) : null}
    </div>
  );
}
