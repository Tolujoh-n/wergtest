import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  connectWallet,
  getCurrentAccount,
  isWalletConnected,
  onAccountsChanged,
  onChainChanged,
  removeListeners,
  ensureWalletConnected,
  BASE_TESTNET_PARAMS,
} from '../utils/blockchain';

const WalletContext = createContext();

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
};

export const WalletProvider = ({ children }) => {
  const [account, setAccount] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [chainId, setChainId] = useState(null);

  const checkConnection = useCallback(async () => {
    try {
      const connected = await isWalletConnected();
      if (connected) {
        const currentAccount = await getCurrentAccount();
        if (currentAccount) {
          setAccount(currentAccount);
        }
        
        // Check chain
        if (typeof window.ethereum !== 'undefined') {
          const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
          setChainId(currentChainId);
        }
      }
    } catch (error) {
      console.error('Error checking wallet connection:', error);
    }
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const address = await connectWallet();
      setAccount(address);
      
      // Get chain ID
      if (typeof window.ethereum !== 'undefined') {
        const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(currentChainId);
      }
      
      return address;
    } catch (error) {
      console.error('Error connecting wallet:', error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setChainId(null);
  }, []);

  useEffect(() => {
    // Check connection on mount
    checkConnection();

    // Set up event listeners
    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        disconnect();
      } else {
        setAccount(accounts[0]);
      }
    };

    const handleChainChanged = (newChainId) => {
      setChainId(newChainId);
      // Reload page on chain change
      window.location.reload();
    };

    onAccountsChanged(handleAccountsChanged);
    onChainChanged(handleChainChanged);

    // Cleanup
    return () => {
      removeListeners();
    };
  }, [checkConnection, disconnect]);

  const ensureConnected = useCallback(async () => {
    setIsConnecting(true);
    try {
      const address = await ensureWalletConnected();
      setAccount(address);
      
      // Get chain ID
      if (typeof window.ethereum !== 'undefined') {
        const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(currentChainId);
      }
      
      return address;
    } catch (error) {
      console.error('Error ensuring wallet connection:', error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const value = {
    account,
    isConnecting,
    chainId,
    isBaseSepolia: chainId === BASE_TESTNET_PARAMS.chainId,
    connect,
    disconnect,
    checkConnection,
    ensureConnected, // Auto-connect if not connected (for transaction signing)
    provider: typeof window.ethereum !== 'undefined' ? window.ethereum : null,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};
