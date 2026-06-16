import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

/**
 * Shared Turnstile state for auth modals.
 * enabled: null = loading, false = off, true = required
 */
export function useTurnstile() {
  const [token, setToken] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [enabled, setEnabled] = useState(null);
  const [siteKey, setSiteKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get('/config/security')
      .then(({ data }) => {
        if (cancelled) return;
        const on = !!(data?.turnstileEnabled && data?.turnstileSiteKey);
        setEnabled(on);
        setSiteKey(on ? data.turnstileSiteKey : '');
      })
      .catch(() => {
        if (!cancelled) {
          setEnabled(false);
          setSiteKey('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clear = useCallback(() => {
    setToken('');
    setResetKey((k) => k + 1);
  }, []);

  const verified = enabled === false || (enabled === true && !!token);
  const loading = enabled === null;

  const assertVerified = useCallback(
    (notify) => {
      if (loading) {
        notify?.('Loading security check…', 'warning');
        return false;
      }
      if (!enabled) return true;
      if (token) return true;
      notify?.('Please complete the security check below before continuing.', 'warning');
      return false;
    },
    [enabled, loading, token]
  );

  return {
    token,
    setToken,
    resetKey,
    clear,
    enabled,
    siteKey,
    verified,
    loading,
    assertVerified,
  };
}
