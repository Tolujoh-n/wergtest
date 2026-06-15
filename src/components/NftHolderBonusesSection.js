import React from 'react';

/**
 * NFT / FT holder bonus table (daily extra tickets). Status uses server on-chain verification.
 */
export default function NftHolderBonusesSection({
  nftBonuses = [],
  user,
  account,
  verifying = false,
  onConnectWallet,
  linkingWallet = false,
  isConnecting = false,
  compact = false,
}) {
  const rowStatus = (n) => {
    if (!user) return { key: 'login', label: 'Log in' };
    if (!account && !n.verifiedOnChain) {
      return { key: 'connect', label: 'Connect wallet' };
    }
    // Verified row — show final status (no loading flash)
    if (n.verifiedOnChain || n.holds === true || n.holds === false) {
      if (n.holds) return { key: 'active', label: 'Active' };
      if (n.holdsOnConnectedOnly) return { key: 'link', label: 'Held — link wallet' };
      return { key: 'none', label: 'Not held' };
    }
    // Still waiting on first on-chain check
    if (verifying) return { key: 'checking', label: 'Checking…' };
    if (!account) return { key: 'connect', label: 'Connect wallet' };
    return { key: 'pending', label: '—' };
  };

  const statusClass = (key) => {
    if (key === 'active') {
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200';
    }
    if (key === 'link') {
      return 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200';
    }
    if (key === 'checking') {
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200';
    }
    return 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          NFT / FT holder bonuses (daily)
          {verifying && user && (
            <span className="ml-2 normal-case font-normal text-blue-600 dark:text-blue-400">Updating…</span>
          )}
        </h3>
        {!account && user && onConnectWallet && (
          <button
            type="button"
            onClick={onConnectWallet}
            disabled={linkingWallet || isConnecting}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shrink-0"
          >
            {linkingWallet || isConnecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        )}
      </div>
      {!account && user && (
        <p className="text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 mb-3 text-xs leading-relaxed">
          Connect your wallet to verify holdings on-chain (ERC-721 NFT, ERC-1155 FT, or ERC-20). Link the wallet to
          your account to receive bonus tickets.
        </p>
      )}
      {account && user && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Verified via contract <span className="font-mono">{account.slice(0, 6)}…{account.slice(-4)}</span>.
          Collections marked <strong>Active</strong> add bonus tickets to your daily total.
        </p>
      )}
      {nftBonuses.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-600">
          <table className={`w-full ${compact ? 'text-xs' : 'text-xs'} min-w-[320px]`}>
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="text-left p-2.5">Collection</th>
                <th className="text-right p-2.5">+Tickets/day</th>
                <th className="text-center p-2.5 hidden sm:table-cell">Type</th>
                <th className="text-center p-2.5">Status</th>
                <th className="text-right p-2.5" />
              </tr>
            </thead>
            <tbody>
              {nftBonuses.map((n, i) => {
                const st = rowStatus(n);
                return (
                  <tr key={n.id || i} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="p-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        {n.imageUrl ? (
                          <img src={n.imageUrl} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
                        ) : (
                          <span className="w-9 h-9 rounded bg-slate-200 dark:bg-slate-600 shrink-0 flex items-center justify-center text-slate-400 text-[10px]">
                            NFT
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 dark:text-white truncate">
                            {n.name || 'Collection'}
                          </div>
                          {n.contractAddress && (
                            <div className="font-mono text-[10px] text-slate-500 truncate" title={n.contractAddress}>
                              {String(n.contractAddress).slice(0, 6)}…{String(n.contractAddress).slice(-4)}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-2.5 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-300">
                      +{n.dailyTickets || 0}
                    </td>
                    <td className="p-2.5 text-center hidden sm:table-cell text-[10px] uppercase text-slate-500">
                      {n.tokenStandard && n.tokenStandard !== 'auto' ? n.tokenStandard : 'auto'}
                    </td>
                    <td className="p-2.5 text-center">
                      <span
                        className={`inline-flex min-w-[4.5rem] justify-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusClass(st.key)}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="p-2.5 text-right">
                      {n.link ? (
                        <a
                          href={n.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline font-medium whitespace-nowrap"
                        >
                          Get
                        </a>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-4 text-center">
          No NFT / FT bonus collections configured yet.
        </p>
      )}
    </div>
  );
}
