import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWallet } from '../context/WalletContext';
import { useNotification } from './Notification';
import api from '../utils/api';

const WalletConnectButton = ({ onSuccess, onConnectClick }) => {
  const [loading, setLoading] = useState(false);
  const { loginWithWallet, user, checkAuth } = useAuth();
  const { connect, account } = useWallet();
  const { showNotification } = useNotification();
  const authInProgressRef = useRef(false);
  const authPromiseRef = useRef(null);

  const authenticateWallet = useCallback(
    async (address, { isLink = false, silent = false } = {}) => {
      if (!address) return;

      const addr = String(address).toLowerCase();
      const key = `${addr}:${isLink ? 'link' : 'login'}`;

      if (authPromiseRef.current?.key === key) {
        return authPromiseRef.current.promise;
      }

      const run = (async () => {
        authInProgressRef.current = true;

        const loadingMsg = isLink ? 'Linking wallet...' : 'Logging in...';
        if (!silent) {
          showNotification(loadingMsg, 'loading', 20000);
        }

        try {
          if (isLink) {
            await api.post('/auth/wallets/link', { address: addr });
            await checkAuth();
            if (!silent) {
              showNotification('Wallet linked successfully!', 'success');
            }
          } else {
            await loginWithWallet(addr);
            if (!silent) {
              showNotification('Login successful!', 'success');
            }
          }
          if (onSuccess) onSuccess();
        } catch (error) {
          console.error('Wallet auth error:', error);
          const message =
            error?.response?.data?.message || 'Failed to connect wallet. Please try again.';
          if (!silent) {
            showNotification(message, 'error');
          }
          throw error;
        } finally {
          authInProgressRef.current = false;
        }
      })();

      authPromiseRef.current = { key, promise: run };
      try {
        await run;
      } finally {
        if (authPromiseRef.current?.key === key) {
          authPromiseRef.current = null;
        }
      }
    },
    [checkAuth, loginWithWallet, onSuccess, showNotification]
  );

  useEffect(() => {
    if (!account) return;
    if (authInProgressRef.current) return;

    if (user) {
      const linked = new Set(
        [...(user.wallets || []), user.walletAddress]
          .filter(Boolean)
          .map((w) => String(w).toLowerCase())
      );
      const addr = String(account).toLowerCase();
      if (linked.has(addr)) return;

      authenticateWallet(account, { isLink: true }).catch(() => {});
    } else {
      authenticateWallet(account, { isLink: false }).catch(() => {});
    }
  }, [account, user, authenticateWallet]);

  const connectWallet = async () => {
    if (onConnectClick) onConnectClick();
    await new Promise((r) => requestAnimationFrame(r));
    setLoading(true);
    try {
      const address = await connect();
      if (!address) return;
      await authenticateWallet(address, { isLink: !!user });
    } catch (error) {
      if (!error?.response && !error?.message) {
        showNotification('Failed to connect wallet. Please try again.', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={connectWallet}
      disabled={loading}
      className="w-full py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 transition-colors flex items-center justify-center space-x-2"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
        />
      </svg>
      <span>{loading ? 'Connecting...' : 'Connect Wallet'}</span>
    </button>
  );
};

export default WalletConnectButton;
