import React, { useState, useEffect } from 'react';
import { initOnboard } from '../utils/web3onboard';
import { useAuth } from '../context/AuthContext';

const WalletConnectButton = ({ onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const { loginWithWallet } = useAuth();
  const [onboard, setOnboard] = useState(null);

  useEffect(() => {
    const onboardInstance = initOnboard();
    setOnboard(onboardInstance);

    // Check for previously connected wallet
    const previouslyConnectedWallets = JSON.parse(
      window.localStorage.getItem('onboard.selectedWallet') || '[]'
    );

    if (previouslyConnectedWallets.length > 0 && onboardInstance) {
      const walletName = previouslyConnectedWallets[0];
      onboardInstance.connectWallet({ autoSelect: walletName }).then((wallets) => {
        if (wallets && wallets.length > 0) {
          const address = wallets[0].accounts[0].address;
          loginWithWallet(address).catch(console.error);
        }
      }).catch(console.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectWallet = async () => {
    if (!onboard) return;
    
    setLoading(true);
    try {
      const wallets = await onboard.connectWallet();
      if (wallets && wallets.length > 0) {
        const address = wallets[0].accounts[0].address;
        await loginWithWallet(address);
        if (onSuccess) onSuccess();
      }
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
