import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { initOnboard } from '../utils/web3onboard';
import { BASE_CHAIN_PARAMS, BASE_TESTNET_PARAMS } from '../utils/chainParams';

const WalletContext = createContext();
const REQUIRED_CHAIN_ID = BASE_CHAIN_PARAMS.chainId;
const PERSISTED_WALLET_LABEL_KEY = 'wergame.walletLabel';

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
  const [provider, setProvider] = useState(null);
  const [walletLabel, setWalletLabel] = useState(null);

  const setFromWallets = useCallback((wallets) => {
    if (wallets && wallets.length > 0) {
      const w = wallets[0];
      const addr = w.accounts?.[0]?.address || null;
      const cid = w.chains?.[0]?.id || null;
      setAccount(addr);
      setChainId(cid);
      setProvider(w.provider || null);
      setWalletLabel(w.label || null);
      if (w.provider && typeof window !== 'undefined') {
        window.ethereum = w.provider;
      }
    } else {
      setAccount(null);
      setChainId(null);
      setProvider(null);
      setWalletLabel(null);
    }
  }, []);

  const getAutoSelectLabel = useCallback(() => {
    try {
      const own = window.localStorage.getItem(PERSISTED_WALLET_LABEL_KEY);
      if (own && typeof own === 'string' && own.trim()) return own.trim();
      const raw = window.localStorage.getItem('onboard.selectedWallet');
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed[0] : (typeof parsed === 'string' ? parsed : null);
    } catch {
      return null;
    }
  }, []);

  const ensureBaseChain = useCallback(async () => {
    const onboard = initOnboard();
    if (!onboard) return;
    const wallets = onboard.state.get().wallets || [];
    if (!wallets.length) return;
    const currentChain = wallets[0]?.chains?.[0]?.id || null;
    if (currentChain && currentChain.toLowerCase() === REQUIRED_CHAIN_ID.toLowerCase()) return;

    // Prompt user to switch chain in wallet
    try {
      await onboard.setChain({ chainId: REQUIRED_CHAIN_ID });
    } catch (e) {
      // Some wallets/providers may still handle switch via EIP-3326 on window.ethereum
      // Let downstream calls surface the error if switching fails.
      console.warn('Failed to switch chain via Onboard:', e);
    }

    setFromWallets(onboard.state.get().wallets || []);
  }, [setFromWallets]);

  const checkConnection = useCallback(async () => {
    try {
      const onboard = initOnboard();
      if (!onboard) return;
      setFromWallets(onboard.state.get().wallets || []);
    } catch (error) {
      console.error('Error checking wallet connection:', error);
    }
  }, [setFromWallets]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const onboard = initOnboard();
      if (!onboard) {
        throw new Error('Wallet UI is not available in this environment');
      }

      // Force showing modal whenever user explicitly clicks connect
      const wallets = await onboard.connectWallet();
      if (!wallets || wallets.length === 0) {
        return null;
      }

      setFromWallets(wallets);
      try {
        const label = wallets[0]?.label;
        if (label) window.localStorage.setItem(PERSISTED_WALLET_LABEL_KEY, label);
      } catch {}
      await ensureBaseChain();
      const addr = wallets[0]?.accounts?.[0]?.address || null;
      return addr;
    } catch (error) {
      console.error('Error connecting wallet:', error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [ensureBaseChain, setFromWallets]);

  const disconnect = useCallback(() => {
    try {
      const onboard = initOnboard();
      if (onboard) {
        const wallets = onboard.state.get().wallets || [];
        wallets.forEach((w) => {
          if (w?.label) {
            onboard.disconnectWallet({ label: w.label });
          }
        });
      }
    } catch {
      // ignore
    }
    try {
      // Prevent auto-reconnect after logout unless user explicitly connects again
      window.localStorage.removeItem('onboard.selectedWallet');
      window.localStorage.removeItem(PERSISTED_WALLET_LABEL_KEY);
    } catch {
      // ignore
    }
    setFromWallets([]);
  }, [setFromWallets]);

  useEffect(() => {
    const onboard = initOnboard();
    if (!onboard) return;

    // Keep app state synchronized with Onboard (connect/disconnect/chain changes)
    const sub = onboard.state.select('wallets').subscribe((wallets) => {
      setFromWallets(wallets || []);
    });

    // Auto-reconnect on refresh (no modal pop)
    const auto = async () => {
      const label = getAutoSelectLabel();
      if (!label) return;
      try {
        const wallets = await onboard.connectWallet({
          autoSelect: { label, disableModals: true },
        });
        setFromWallets(wallets || onboard.state.get().wallets || []);
        await ensureBaseChain();
      } catch (e) {
        // If auto reconnect fails, keep disconnected (user can click connect)
        console.warn('Auto-reconnect failed:', e);
      }
    };

    auto();

    // Listen for app logout to disconnect wallets
    const onLogout = () => disconnect();
    window.addEventListener('app:logout', onLogout);

    return () => {
      try {
        sub?.unsubscribe?.();
      } catch {}
      window.removeEventListener('app:logout', onLogout);
    };
  }, [disconnect, ensureBaseChain, getAutoSelectLabel, setFromWallets]);

  const ensureConnected = useCallback(async () => {
    setIsConnecting(true);
    try {
      const onboard = initOnboard();
      if (!onboard) throw new Error('Wallet UI is not available in this environment');

      const already = onboard.state.get().wallets || [];
      if (already.length > 0) {
        setFromWallets(already);
        await ensureBaseChain();
        const addr = already[0]?.accounts?.[0]?.address || null;
        return addr;
      }

      // Try autoSelect the last wallet if present; otherwise show modal
      const autoSelectLabel = getAutoSelectLabel();

      const wallets = autoSelectLabel
        ? await onboard.connectWallet({ autoSelect: { label: autoSelectLabel, disableModals: false } })
        : await onboard.connectWallet();

      if (!wallets || wallets.length === 0) return null;

      setFromWallets(wallets);
      await ensureBaseChain();
      return wallets[0]?.accounts?.[0]?.address || null;
    } catch (error) {
      console.error('Error ensuring wallet connection:', error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [ensureBaseChain, getAutoSelectLabel, setFromWallets]);

  const value = {
    account,
    isConnecting,
    chainId,
    isOnBaseChain: chainId === REQUIRED_CHAIN_ID,
    /** @deprecated use isOnBaseChain */
    isBaseSepolia: chainId === BASE_TESTNET_PARAMS.chainId,
    connect,
    disconnect,
    checkConnection,
    ensureConnected, // Auto-connect if not connected (for transaction signing)
    provider,
    walletLabel,
    ensureBaseChain,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};
