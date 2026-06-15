import api from './api';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HOLDINGS_POLL_DELAYS_MS = [2000, 3000, 4000, 5000, 5000, 8000];

async function pollHoldingsUntilFresh(walletParams, signal, onUpdate) {
  for (const delay of HOLDINGS_POLL_DELAYS_MS) {
    if (signal?.aborted) return;
    await sleep(delay);
    if (signal?.aborted) return;
    try {
      const { data: bal } = await api.get('/tickets/balances', { ...walletParams, signal });
      const list = Array.isArray(bal?.nftBonuses) ? bal.nftBonuses : [];
      onUpdate?.({
        nftBonuses: list,
        balances: bal,
        verifying: !!bal.holdingsRefreshing,
        loaded: true,
      });
      if (!bal.holdingsRefreshing) return;
    } catch {
      /* keep polling */
    }
  }
}

/**
 * Load free-ticket balances + NFT bonus rows (single request when logged in).
 * Cached holdings return immediately; on-chain verification continues in the background.
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
  if (!keepStale) {
    onUpdate?.({ verifying: true });
  }

  try {
    const { data: bal } = await api.get('/tickets/balances', { ...walletParams, signal });
    const list = Array.isArray(bal?.nftBonuses) ? bal.nftBonuses : [];
    const isRefreshing = !!bal.holdingsRefreshing;
    onUpdate?.({
      nftBonuses: list,
      balances: bal,
      verifying: isRefreshing,
      loaded: true,
    });
    if (isRefreshing) {
      await pollHoldingsUntilFresh(walletParams, signal, onUpdate);
    }
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
