import api from './api';

/**
 * Load free-ticket balances + NFT bonus rows (single request when logged in).
 * Keeps prior UI data during background refresh when keepStale is true.
 */
export async function loadFreeTicketData({ user, account, signal, onUpdate, keepStale = true }) {
  if (!user) {
    try {
      const { data } = await api.get('/tickets/nft-bonuses/config', { signal });
      onUpdate?.({
        nftBonuses: Array.isArray(data?.nftBonuses) ? data.nftBonuses : [],
        balances: null,
        verifying: false,
      });
    } catch {
      onUpdate?.({ nftBonuses: [], balances: null, verifying: false });
    }
    return;
  }

  const walletParams = account ? { params: { walletAddress: account } } : {};
  onUpdate?.({ verifying: true });

  try {
    const { data: bal } = await api.get('/tickets/balances', { ...walletParams, signal });
    const list = Array.isArray(bal?.nftBonuses) ? bal.nftBonuses : [];
    onUpdate?.({
      nftBonuses: list,
      balances: bal,
      verifying: false,
      loaded: true,
    });
  } catch {
    onUpdate?.({
      verifying: false,
      ...(keepStale ? {} : { nftBonuses: [], balances: null }),
    });
  }
}

/** @deprecated Use loadFreeTicketData — kept for any stale imports during transition. */
export async function loadFreeTicketDataPhased(opts) {
  return loadFreeTicketData(opts);
}
