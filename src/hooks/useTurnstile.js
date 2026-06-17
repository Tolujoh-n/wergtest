import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';

let cachedConfig = null;
let configPromise = null;

async function loadTurnstileConfig() {
  if (cachedConfig) return cachedConfig;
  if (!configPromise) {
    configPromise = api
      .get('/config/security')
      .then(({ data }) => {
        const on = !!(data?.turnstileEnabled && data?.turnstileSiteKey);
        cachedConfig = {
          enabled: on,
          siteKey: on ? data.turnstileSiteKey : '',
        };
        return cachedConfig;
      })
      .catch(() => {
        cachedConfig = { enabled: false, siteKey: '' };
        return cachedConfig;
      });
  }
  return configPromise;
}

/**
 * Shared Turnstile state for auth modals.
 * enabled: null = loading, false = off, true = required
 */
export function useTurnstile() {
  const [token, setTokenState] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [enabled, setEnabled] = useState(null);
  const [siteKey, setSiteKey] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadTurnstileConfig().then((cfg) => {
      if (!mountedRef.current) return;
      setEnabled(cfg.enabled);
      setSiteKey(cfg.siteKey);
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const setToken = useCallback((value) => {
    setTokenState(value || '');
  }, []);

  const clearToken = useCallback(() => {
    setTokenState('');
  }, []);

  const resetWidget = useCallback(() => {
    setTokenState('');
    setResetKey((k) => k + 1);
  }, []);

  const verified = enabled === false || (enabled === true && !!token);
  const loading = enabled === null;

  const assertVerified = useCallback(
    (notify) => {
      if (loading) {
        notify?.('Security check is still loading…', 'warning');
        return false;
      }
      if (!enabled) return true;
      if (token) return true;
      notify?.('Please complete the security check first.', 'warning');
      return false;
    },
    [enabled, loading, token]
  );

  return {
    token,
    setToken,
    clearToken,
    resetKey,
    resetWidget,
    clear: resetWidget,
    enabled,
    siteKey,
    verified,
    loading,
    assertVerified,
  };
}
