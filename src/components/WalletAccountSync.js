import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWallet } from '../context/WalletContext';
import api from '../utils/api';

/**
 * When a logged-in user connects a wallet, link it to their account (once)
 * and refresh session so on-chain admin access appears in the nav.
 */
export default function WalletAccountSync() {
  const { user, refreshUser } = useAuth();
  const { account } = useWallet();
  const lastHandled = useRef(null);
  const linkInFlight = useRef(false);

  useEffect(() => {
    if (!user?._id) {
      lastHandled.current = null;
      linkInFlight.current = false;
    }
  }, [user?._id]);

  useEffect(() => {
    if (!user?._id || !account) return;

    const addr = String(account).toLowerCase();
    const key = `${user._id}:${addr}`;
    if (lastHandled.current === key) return;

    const linked = new Set(
      [...(user.wallets || []), user.walletAddress].filter(Boolean).map((w) => String(w).toLowerCase())
    );

    if (linked.has(addr)) {
      lastHandled.current = key;
      return;
    }

    if (linkInFlight.current) return;
    linkInFlight.current = true;

    api
      .post('/auth/wallets/link', { address: account })
      .then((res) => {
        lastHandled.current = key;
        if (res.data?.user) refreshUser(res.data.user);
        else refreshUser();
      })
      .catch((err) => {
        console.warn('[WalletAccountSync] link failed:', err?.response?.data?.message || err.message);
      })
      .finally(() => {
        linkInFlight.current = false;
      });
  }, [user?._id, user?.wallets, user?.walletAddress, account, refreshUser]);

  return null;
}
