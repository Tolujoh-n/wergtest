import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import Modal from './Modal';
import { useWallet } from '../context/WalletContext';
import { useAuth } from '../context/AuthContext';
import { useNotification } from './Notification';
import { useFreeTicketData } from '../hooks/useFreeTicketData';
import NftHolderBonusesSection from './NftHolderBonusesSection';
import TicketBalanceCards from './TicketBalanceCards';

function DrawOutcomeAvatar({ className = 'w-10 h-10' }) {
  return (
    <div
      className={`${className} rounded-full border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0`}
      aria-hidden
    >
      <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" d="M4 12h16M12 4v16" />
      </svg>
    </div>
  );
}

function OutcomePickAvatar({ image, label, sizeClass = 'w-10 h-10' }) {
  if (image === 'draw-icon') return <DrawOutcomeAvatar className={sizeClass} />;
  if (image) {
    return (
      <img
        src={image}
        alt={label || ''}
        className={`${sizeClass} rounded-full object-cover border border-slate-200 dark:border-slate-600 shrink-0`}
      />
    );
  }
  return <div className={`${sizeClass} rounded-full bg-slate-200 dark:bg-slate-700 shrink-0`} aria-hidden />;
}

/**
 * Ticket picker for free predictions — balances, NFT/FT bonus table, connect wallet, stake count.
 */
export default function FreePredictionModal({
  open,
  onClose,
  outcomeLabel,
  outcomeImage = null,
  outcomeSuffix = '',
  minTickets = 1,
  onConfirm,
  loading = false,
}) {
  const { account, ensureConnected, isConnecting } = useWallet();
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [stake, setStake] = useState(minTickets);
  const [linkingWallet, setLinkingWallet] = useState(false);
  const {
    balances,
    nftBonuses,
    verifying,
    balancesLoading,
    reload,
  } = useFreeTicketData(open ? user : null, open ? account : null);

  useEffect(() => {
    if (open) setStake(minTickets);
  }, [open, minTickets]);

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
      await reload();
    } catch (e) {
      showNotification(e.response?.data?.message || e.message || 'Could not connect wallet', 'error');
    } finally {
      setLinkingWallet(false);
    }
  };

  const total = balances?.totalSpendable ?? 0;
  const maxStake = Math.max(minTickets, total);
  const nftBonusActive = (balances?.nftBonusToday || 0) > 0;

  const dec = () => setStake((s) => Math.max(minTickets, s - 1));
  const inc = () => setStake((s) => Math.min(maxStake, s + 1));
  const setMax = () => setStake(maxStake);

  if (!open) return null;

  return (
    <Modal isOpen={open} onClose={onClose} title="Free prediction" size="lg">
      <div className="space-y-5 text-sm">
        {outcomeLabel ? (
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-600 p-3 bg-slate-50/80 dark:bg-slate-800/50">
            <OutcomePickAvatar image={outcomeImage} label={outcomeLabel} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Your pick</div>
              <div className="font-bold text-base text-gray-900 dark:text-white truncate">
                {outcomeLabel}
                {outcomeSuffix}
              </div>
            </div>
          </div>
        ) : null}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Your tickets</h3>
          <TicketBalanceCards user={user} balances={balances} loading={balancesLoading} />
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
            Tickets for this pick (min {minTickets})
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            More tickets = larger jackpot share if you win (weighted by tickets staked).
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={dec}
              disabled={stake <= minTickets}
              className="w-10 h-10 rounded-lg border border-slate-300 dark:border-slate-600 font-bold disabled:opacity-40"
            >
              −
            </button>
            <span className="flex-1 text-center text-xl font-bold tabular-nums">{stake}</span>
            <button
              type="button"
              onClick={inc}
              disabled={!user || balancesLoading || stake >= maxStake}
              className="w-10 h-10 rounded-lg border border-slate-300 dark:border-slate-600 font-bold disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              onClick={setMax}
              disabled={!user || balancesLoading || maxStake < minTickets}
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
            className="flex-1 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !user || balancesLoading || total < stake}
            onClick={() => onConfirm(stake)}
            className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50 hover:bg-emerald-700 flex items-center justify-center gap-2 min-w-0"
          >
            {loading ? (
              '…'
            ) : (
              <>
                <OutcomePickAvatar image={outcomeImage} label={outcomeLabel} sizeClass="w-7 h-7" />
                <span className="truncate">{outcomeLabel || 'Confirm'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
