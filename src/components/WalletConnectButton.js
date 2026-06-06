import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWallet } from '../context/WalletContext';
import api from '../utils/api';

const WalletConnectButton = ({ onSuccess, onConnectClick }) => {
  const [loading, setLoading] = useState(false);
  const { loginWithWallet, user, checkAuth } = useAuth();
  const { connect, account } = useWallet();

  useEffect(() => {
    if (!account) return;
    // Logged in: link wallet to this account (do not switch users).
    if (user) {
      api.post('/auth/wallets/link', { address: account }).then(() => checkAuth()).catch(() => {});
    } else {
      loginWithWallet(account).catch(console.error);
    }
  }, [account, loginWithWallet, user, checkAuth]);

  const connectWallet = async () => {
    if (onConnectClick) onConnectClick();
    await new Promise((r) => requestAnimationFrame(r));
    setLoading(true);
    try {
      const address = await connect();
      if (!address) return;
      if (user) {
        await api.post('/auth/wallets/link', { address });
        await checkAuth();
      } else {
        await loginWithWallet(address);
      }
      if (onSuccess) onSuccess();
    } catch (error) {
      console.error('Wallet connection error:', error);
      alert('Failed to connect wallet. Please try again.');
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
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>
      <span>{loading ? 'Connecting...' : 'Connect Wallet'}</span>
    </button>
  );
};

export default WalletConnectButton;
