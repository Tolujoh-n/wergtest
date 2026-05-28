import api from './api';

/**
 * Load free-ticket UI in two phases: admin config first (fast), balances + on-chain verify second.
 */
export async function loadFreeTicketDataPhased({ user, account, signal, onPhase }) {
  const walletParams = account ? { params: { walletAddress: account } } : {};

  let configRows = [];
  try {
    const { data } = await api.get('/tickets/nft-bonuses/config', { signal });
    configRows = Array.isArray(data?.nftBonuses) ? data.nftBonuses : [];
    onPhase?.({
      nftBonuses: configRows,
      balances: user ? undefined : null,
      verifying: !!user,
    });
  } catch {
    configRows = [];
    onPhase?.({ nftBonuses: [], balances: user ? undefined : null, verifying: !!user });
  }

  if (!user) {
    onPhase?.({ nftBonuses: configRows, balances: null, verifying: false });
    return { nftBonuses: configRows, balances: null };
  }

  try {
    const { data: bal } = await api.get('/tickets/balances', { ...walletParams, signal });
    const list =
      Array.isArray(bal?.nftBonuses) && bal.nftBonuses.length ? bal.nftBonuses : configRows;
    onPhase?.({
      nftBonuses: list,
      balances: bal,
      verifying: false,
    });
    return { nftBonuses: list, balances: bal };
  } catch {
    onPhase?.({
      nftBonuses: configRows,
      balances: null,
      verifying: false,
    });
    return { nftBonuses: configRows, balances: null };
  }
}
