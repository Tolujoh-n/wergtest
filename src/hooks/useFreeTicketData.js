import { useState, useCallback, useEffect, useRef } from 'react';
import { loadFreeTicketData } from '../utils/freeTicketLoad';

/**
 * Ticket balances + NFT bonus table with stale-while-revalidate (no flicker on wallet refresh).
 */
export function useFreeTicketData(user, account) {
  const [balances, setBalances] = useState(null);
  const [nftBonuses, setNftBonuses] = useState([]);
  const [verifying, setVerifying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const loadGenRef = useRef(0);
  const loadedRef = useRef(false);
  const prevUserKeyRef = useRef('');
  const userRef = useRef(user);
  const accountRef = useRef(account);
  userRef.current = user;
  accountRef.current = account;

  const accountKey = account ? String(account).toLowerCase() : '';
  const userKey = user?._id != null ? String(user._id) : '';

  const reload = useCallback(async () => {
    const gen = ++loadGenRef.current;
    const isFirstLoad = !loadedRef.current;
    const currentUser = userRef.current;
    const currentAccount = accountRef.current;

    await loadFreeTicketData({
      user: currentUser,
      account: currentAccount,
      keepStale: !isFirstLoad,
      onUpdate: (patch) => {
        if (gen !== loadGenRef.current) return;
        if (patch.nftBonuses !== undefined) setNftBonuses(patch.nftBonuses);
        if (patch.balances !== undefined) setBalances(patch.balances);
        if (patch.verifying !== undefined) {
          setVerifying(patch.verifying);
        }
        if (patch.loaded) {
          loadedRef.current = true;
          setLoaded(true);
        }
      },
    });
  }, []);

  useEffect(() => {
    if (userKey !== prevUserKeyRef.current) {
      prevUserKeyRef.current = userKey;
      loadedRef.current = false;
      setLoaded(false);
      setBalances(null);
      setNftBonuses([]);
      setVerifying(false);
    }
    reload();
  }, [userKey, accountKey, reload]);

  const balancesLoading = !!user && !loaded && balances == null;

  return {
    balances,
    nftBonuses,
    verifying,
    balancesLoading,
    loaded,
    reload,
  };
}
