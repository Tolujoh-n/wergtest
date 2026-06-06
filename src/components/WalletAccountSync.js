import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWallet } from '../context/WalletContext';
import api from '../utils/api';

/**
 * When a logged-in user connects a wallet, link it to their account (if needed)
 * and refresh session so on-chain admin access appears in the nav.
 */
export default function WalletAccountSync() {
  const { user, refreshUser } = useAuth();
  const { account } = useWallet();
  const lastHandled = useRef(null);

  useEffect(() => {
    if (!user?._id || !account) return;

    const addr = String(account).toLowerCase();
    const key = `${user._id}:${addr}`;
    if (lastHandled.current === key && user.canAccessAdmin) return;

    const linked = new Set(
      [...(user.wallets || []), user.walletAddress].filter(Boolean).map((w) => String(w).toLowerCase())
    );

    const finish = (payload) => {
      lastHandled.current = key;
      if (payload) refreshUser(payload);
      else refreshUser();
    };

    if (linked.has(addr)) {
      finish(null);
      return;
    }

    api
      .post('/auth/wallets/link', { address: account })
      .then((res) => finish(res.data?.user))
      .catch((err) => {
        console.warn('[WalletAccountSync] link failed:', err?.response?.data?.message || err.message);
      });
  }, [user, account, refreshUser]);

  return null;
}
