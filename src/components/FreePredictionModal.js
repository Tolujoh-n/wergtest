import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import api from '../utils/api';
import Modal from './Modal';
import { useWallet } from '../context/WalletContext';
import { useAuth } from '../context/AuthContext';
import { useNotification } from './Notification';
import { enrichNftBonusesWithClientHolds } from '../utils/tokenHoldings';
import { mergeNftBonusRows } from '../utils/mergeNftBonuses';
import NftHolderBonusesSection from './NftHolderBonusesSection';

function SubmitSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 shrink-0 text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/**
 * Ticket picker for free predictions — balances, NFT/FT bonus table, connect wallet, stake count.
 */
export default function FreePredictionModal({
  open,
  onClose,
  outcomeLabel,
  outcomeSuffix = '',
  outcomeImage = null,
  mode = 'create',
  existingTicketsStaked = 1,
  minTickets = 1,
  onConfirm,
  loading = false,
}) {
  const { account, ensureConnected, isConnecting } = useWallet();
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [balances, setBalances] = useState(null);
  const [nftBonuses, setNftBonuses] = useState([]);
  const [stake, setStake] = useState(minTickets);
  const [linkingWallet, setLinkingWallet] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const nftLoadedRef = useRef(false);

  const walletParams = useCallback(() => {
    if (!account) return {};
    return { params: { walletAddress: account } };
  }, [account]);

  const load = useCallback(async () => {
    const showVerify = !nftLoadedRef.current && !!account && !!user;
    if (showVerify) setVerifying(true);
    try {
      const { data: pub } = await api.get('/tickets/nft-bonuses', walletParams());
      let list = Array.isArray(pub?.nftBonuses) ? pub.nftBonuses : [];

      if (user) {
        try {
          const { data } = await api.get('/tickets/balances', walletParams());
          setBalances(data);
          if (Array.isArray(data?.nftBonuses) && data.nftBonuses.length) {
            list = data.nftBonuses;
          }
        } catch {
          setBalances(null);
        }
      } else {
        setBalances(null);
      }

      if (account && list.length) {
        list = await enrichNftBonusesWithClientHolds(list, account);
      }
      setNftBonuses((prev) => mergeNftBonusRows(prev, list));
      nftLoadedRef.current = true;
    } catch {
      setNftBonuses([]);
    } finally {
      setVerifying(false);
    }
  }, [user, account, walletParams]);

  useEffect(() => {
    if (open) {
      setStake(minTickets);
      load();
    } else {
      nftLoadedRef.current = false;
    }
  }, [open, minTickets, load]);

  const handleConnectWallet = async () => {
    if (!user) {
      showNotification('Please log in first', 'warning');
      return;
    }
    setLinkingWallet(true);
    try {
      const addr = account || (await ensureConnected());
      if (!addr) return;
      await api.post('/auth/wallets/link', { address: addr });
      showNotification('Wallet linked — verifying holdings on-chain…', 'success');
      await load();
    } catch (e) {
      showNotification(e.response?.data?.message || e.message || 'Could not connect wallet', 'error');
    } finally {
      setLinkingWallet(false);
    }
  };

  const total = balances?.totalSpendable ?? 0;
  const maxStake = Math.max(minTickets, total);
  const nftBonusActive = (balances?.nftBonusToday || 0) > 0;
  const isAddMode = mode === 'add';

  const dec = () => setStake((s) => Math.max(minTickets, s - 1));
  const inc = () => setStake((s) => Math.min(maxStake, s + 1));
  const setMax = () => setStake(maxStake);

  const pickLabel = `${outcomeLabel || 'Confirm'}${outcomeSuffix || ''}`;

  const confirmButtonLabel = useMemo(() => {
    if (isAddMode) return `Add ${stake} ticket${stake === 1 ? '' : 's'}`;
    return `Confirm ${pickLabel}`;
  }, [isAddMode, stake, pickLabel]);

  const loadingButtonLabel = isAddMode ? 'Adding tickets…' : 'Submitting prediction…';

  if (!open) return null;

  return (
    <Modal isOpen={open} onClose={onClose} title={isAddMode ? 'Add tickets' : 'Free prediction'} size="lg">
      <div className="space-y-5 text-sm">
        {pickLabel && (
          <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Your pick</div>
            <div className="font-semibold text-slate-900 dark:text-white">{pickLabel}</div>
            {isAddMode && (
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Currently staked: {Math.max(1, parseInt(existingTicketsStaked, 10) || 1)} ticket
                {(Math.max(1, parseInt(existingTicketsStaked, 10) || 1)) === 1 ? '' : 's'}
              </div>
            )}
          </div>
        )}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Your tickets</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-200 dark:border-slate-600 p-3 flex items-center gap-3">
              <span className="text-2xl shrink-0" aria-hidden>
                🎟️
              </span>
              <div>
                <div className="text-xs text-slate-500">Daily (normal)</div>
                <div className="font-bold text-lg tabular-nums">{user ? (balances?.normalTickets ?? '…') : '—'}</div>
              </div>
            </div>
            <div className="rounded-lg border border-amber-300/60 dark:border-amber-700 p-3 flex items-center gap-3 bg-amber-50/50 dark:bg-amber-950/30">
              <span className="text-2xl shrink-0" aria-hidden>
                ⭐
              </span>
              <div>
                <div className="text-xs text-slate-500">Golden</div>
                <div className="font-bold text-lg tabular-nums text-amber-800 dark:text-amber-200">
                  {user ? (balances?.goldenTickets ?? '…') : '—'}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-emerald-300/60 dark:border-emerald-700 p-3 bg-emerald-50/50 dark:bg-emerald-950/30">
              <div className="text-xs text-slate-500">Total available</div>
              <div className="font-bold text-lg tabular-nums text-emerald-800 dark:text-emerald-200">
                {user ? total : '—'}
              </div>
              {nftBonusActive && (
                <div className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                  includes +{balances.nftBonusToday} NFT/FT bonus today
                </div>
              )}
            </div>
          </div>
        </div>

        <NftHolderBonusesSection
          nftBonuses={nftBonuses}
          user={user}
          account={account}
          verifying={verifying}
          onConnectWallet={handleConnectWallet}
          linkingWallet={linkingWallet}
          isConnecting={isConnecting}
        />

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            {isAddMode ? `Tickets to add (min ${minTickets})` : `Tickets for this pick (min ${minTickets})`}
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            More tickets = larger jackpot share if you win (weighted by tickets staked).
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={dec}
              disabled={loading || stake <= minTickets}
              className="w-10 h-10 rounded-lg border border-slate-300 dark:border-slate-600 font-bold disabled:opacity-40"
            >
              −
            </button>
            <span className="flex-1 text-center text-xl font-bold tabular-nums">{stake}</span>
            <button
              type="button"
              onClick={inc}
              disabled={loading || !user || stake >= maxStake}
              className="w-10 h-10 rounded-lg border border-slate-300 dark:border-slate-600 font-bold disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              onClick={setMax}
              disabled={loading || !user || maxStake < minTickets}
              className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold disabled:opacity-40"
            >
              Max
            </button>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !user || total < stake}
            onClick={() => onConfirm(stake)}
            className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50 hover:bg-emerald-700 inline-flex items-center justify-center gap-2 min-h-[44px]"
          >
            {loading ? (
              <>
                <SubmitSpinner />
                <span>{loadingButtonLabel}</span>
              </>
            ) : (
              confirmButtonLabel
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
