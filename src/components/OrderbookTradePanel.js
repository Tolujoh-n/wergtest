import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../utils/api';
import { depositTradingVault, getTradingVaultBalance } from '../utils/blockchain';
import { formatUsdAmount } from '../utils/money';
import { estimateMarketOrderbookPotentialWin } from '../utils/predictionPayout';
import { isNewBuysPaused, pauseLabel } from '../utils/orderbookPause';

/** Trim trailing zeros from a decimal string for inputs (no forced .0000). */
function trimDecimalString(n, maxDp = 12) {
  if (n == null || !Number.isFinite(n) || n < 0) return '';
  if (n === 0) return '';
  const s = n.toFixed(maxDp).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  return s;
}

/** Compact fingerprint for one side of the book (avoids re-render when unchanged). */
function fingerprintSideBook(book) {
  const norm = (rows) =>
    (rows || [])
      .map((r) => `${String(r._id || '')}:${Number(r.limitPrice)}:${Number(r.sizeRemaining)}`)
      .join(',');
  if (!book) return '||';
  return `${norm(book.bids)}|${norm(book.asks)}`;
}

/** Match backend estimateBuyLimitVaultNeedUsd: fills at asks ≤ limit (notional + fee) + remainder × limit. */
function estimateLimitBuyVaultFromBook(asks, walletLower, size, limitPx, feeRate) {
  if (!(size > 0) || !Number.isFinite(limitPx)) return 0;
  const sorted = [...(asks || [])].sort((a, b) => Number(a.limitPrice) - Number(b.limitPrice));
  let rem = size;
  let immediate = 0;
  const w = String(walletLower || '').toLowerCase();
  const fr = Number.isFinite(feeRate) && feeRate >= 0 ? feeRate : 0.1;
  for (const row of sorted) {
    if (rem <= 1e-9) break;
    if (String(row.walletAddress || '').toLowerCase() === w) continue;
    const ap = Number(row.limitPrice);
    if (!Number.isFinite(ap) || ap > limitPx + 1e-9) break;
    const ts = Math.min(rem, Number(row.sizeRemaining) || 0);
    if (ts <= 1e-9) continue;
    const n = ts * ap;
    immediate += n + n * fr;
    rem = parseFloat((rem - ts).toFixed(6));
  }
  const rest = rem > 1e-9 ? rem * limitPx : 0;
  return parseFloat((immediate + rest).toFixed(6));
}

function withTimeout(promise, ms, message = 'Request timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

const ORDER_POST_TIMEOUT_MS = 20000;
export default function OrderbookTradePanel({
  itemData,
  isPoll,
  matchId,
  pollId,
  user,
  account,
  ensureLinkedWallet,
  showNotification,
  locked,
  selectedOptionKey,
  selectedSide,
  onChangeOptionKey,
  onChangeSide,
  hideOutcomeSelector,
  onOrderPlaced,
  vaultRefreshNonce = 0,
}) {
  const [vaultInfo, setVaultInfo] = useState(null);
  const [book, setBook] = useState({ bids: [], asks: [] });
  const [orderKind, setOrderKind] = useState('limit');
  const [optionKey, setOptionKey] = useState('');
  const [side, setSide] = useState('YES');
  const [direction, setDirection] = useState('buy');
  const [limitPrice, setLimitPrice] = useState('0.5');
  const [size, setSize] = useState('');
  const [sizeInputMode, setSizeInputMode] = useState('shares');
  const [usdcNotional, setUsdcNotional] = useState('');
  const [slippageBps, setSlippageBps] = useState('150');
  const [expiryEnabled, setExpiryEnabled] = useState(false);
  const [expiryPreset, setExpiryPreset] = useState('24');
  const [expiryCustomHours, setExpiryCustomHours] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [takerFeeRate, setTakerFeeRate] = useState(0.11);
  const lastBookFpRef = useRef('');
  const lastVaultFpRef = useRef('');
  const vaultFetchGenRef = useRef(0);

  const chainMarketId = itemData?.marketId;
  const orderbook = itemData?.orderbook || {};
  const buysPaused = isNewBuysPaused(orderbook, optionKey, side);
  const pauseNotice = buysPaused ? pauseLabel(orderbook, optionKey, side, { itemData, isPoll }) : null;

  const outcomeChoices = useMemo(
    () =>
      !isPoll
        ? [
            { key: 'TeamA', label: itemData.teamA || 'Team A' },
            ...(itemData.drawEnabled !== false ? [{ key: 'Draw', label: 'Draw' }] : []),
            { key: 'TeamB', label: itemData.teamB || 'Team B' },
          ]
        : (itemData.options || []).map((o) => ({ key: o.text, label: o.text })),
    [isPoll, itemData.teamA, itemData.teamB, itemData.options, itemData.drawEnabled]
  );

  const selectedOutcomeLabel = useMemo(() => {
    const k = String(optionKey || '').trim();
    if (!isPoll) {
      if (k === 'TeamA') return itemData.teamA || 'Team A';
      if (k === 'TeamB') return itemData.teamB || 'Team B';
      if (k === 'Draw') return 'Draw';
      return k || '—';
    }
    const hit = (itemData.options || []).find((o) => String(o.text || '').trim() === k);
    return hit?.text || k || '—';
  }, [optionKey, isPoll, itemData.teamA, itemData.teamB, itemData.options]);

  const resolveExpiryHours = useCallback(() => {
    if (!expiryEnabled) return null;
    if (expiryPreset === 'custom') {
      const h = parseFloat(expiryCustomHours);
      return Number.isFinite(h) && h > 0 ? h : null;
    }
    const map = { '5': 5, '24': 24, '72': 72, '168': 168 };
    const h = map[expiryPreset];
    return Number.isFinite(h) && h > 0 ? h : null;
  }, [expiryEnabled, expiryPreset, expiryCustomHours]);

  const expiresAtIso = useMemo(() => {
    const h = resolveExpiryHours();
    if (h == null) return undefined;
    return new Date(Date.now() + h * 3600 * 1000).toISOString();
  }, [resolveExpiryHours]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/orderbook/defaults');
        const fr = Number(data?.takerFeeRate);
        if (!cancelled && Number.isFinite(fr) && fr >= 0 && fr < 1) setTakerFeeRate(fr);
      } catch {
        /* keep default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!optionKey && outcomeChoices.length) setOptionKey(outcomeChoices[0].key);
  }, [optionKey, outcomeChoices]);

  useEffect(() => {
    if (selectedOptionKey !== undefined && selectedOptionKey !== null && String(selectedOptionKey).trim() !== '') {
      setOptionKey(String(selectedOptionKey).trim());
    }
  }, [selectedOptionKey]);

  useEffect(() => {
    if (selectedSide === 'YES' || selectedSide === 'NO') setSide(selectedSide);
  }, [selectedSide]);

  useEffect(() => {
    lastBookFpRef.current = '';
  }, [optionKey, side, chainMarketId]);

  useEffect(() => {
    lastVaultFpRef.current = '';
  }, [user, account]);

  const refreshVault = useCallback(async () => {
    if (!user || !account) {
      setVaultInfo(null);
      return;
    }
    const gen = ++vaultFetchGenRef.current;

    getTradingVaultBalance(account)
      .then((chainStr) => {
        if (vaultFetchGenRef.current !== gen) return;
        const chainNum = parseFloat(String(chainStr).replace(/,/g, ''));
        if (!Number.isFinite(chainNum)) return;
        setVaultInfo((prev) => {
          const reserved = Number(prev?.reservedUsdc);
          const hasReserved = Number.isFinite(reserved);
          return {
            ...prev,
            walletAddress: account,
            onChainVaultUsdc: chainNum,
            vaultReadFromWallet: true,
            reservedUsdc: hasReserved ? reserved : prev?.reservedUsdc ?? 0,
            availableUsdc: hasReserved ? Math.max(0, chainNum - reserved) : prev?.availableUsdc ?? null,
            contractAddress: prev?.contractAddress,
          };
        });
      })
      .catch(() => {});

    const fetchVaultFromApi = async () => {
      const { data } = await api.get('/orderbook/vault', {
        params: { walletAddress: account },
        timeout: 20000,
      });
      return data || {};
    };

    let d = null;
    try {
      d = await fetchVaultFromApi();
    } catch {
      try {
        await new Promise((r) => setTimeout(r, 700));
        if (vaultFetchGenRef.current !== gen) return;
        d = await fetchVaultFromApi();
      } catch {
        d = null;
      }
    }

    if (vaultFetchGenRef.current !== gen) return;

    if (d) {
      const onChainVaultUsdc = Number(d.onChainVaultUsdc) || 0;
      const reservedUsdc = Number(d.reservedUsdc) || 0;
      const merged = {
        ...d,
        onChainVaultUsdc,
        reservedUsdc,
        availableUsdc: Math.max(0, onChainVaultUsdc - reservedUsdc),
        vaultReadFromWallet: true,
        reservedLoading: false,
      };
      const fp = JSON.stringify({
        o: merged.onChainVaultUsdc,
        r: merged.reservedUsdc,
        a: merged.availableUsdc,
      });
      if (lastVaultFpRef.current !== fp) {
        lastVaultFpRef.current = fp;
        setVaultInfo(merged);
      }
      return;
    }

    setVaultInfo((prev) => ({
      ...prev,
      walletAddress: account,
      reservedLoading: false,
      reservedUsdc: prev?.reservedUsdc ?? 0,
      availableUsdc:
        prev?.onChainVaultUsdc != null && Number.isFinite(prev.onChainVaultUsdc)
          ? Math.max(0, Number(prev.onChainVaultUsdc) - (Number(prev?.reservedUsdc) || 0))
          : prev?.availableUsdc ?? null,
    }));
  }, [user, account]);

  const readVaultAvailableUsdc = useCallback(async (walletAddr) => {
    try {
      const { data } = await api.get('/orderbook/vault', {
        params: { walletAddress: walletAddr },
        timeout: 15000,
      });
      const reserved = Number(data?.reservedUsdc) || 0;
      const vault = Number(data?.onChainVaultUsdc);
      if (Number.isFinite(vault)) {
        return Math.max(0, vault - reserved);
      }
    } catch {
      /* fall through to chain read */
    }

    try {
      const chainStr = await getTradingVaultBalance(walletAddr);
      const chainNum = chainStr != null ? parseFloat(String(chainStr).replace(/,/g, '')) : NaN;
      if (Number.isFinite(chainNum)) return Math.max(0, chainNum);
    } catch {
      /* ignore */
    }
    return 0;
  }, []);

  /** Fund vault via wallet until backend sees enough available USDC for this buy (or failure). */
  const ensureBuyVaultFunded = useCallback(
    async (walletAddr, requiredUsdc) => {
      if (!(requiredUsdc > 1e-9)) return true;
      let avail = await readVaultAvailableUsdc(walletAddr);
      if (avail >= requiredUsdc - 1e-6) return true;
      const short = requiredUsdc - avail;
      const depositAmt = Math.max(0.01, Math.ceil(short * 10000) / 10000);
      showNotification(
        `Fund your trading vault with about ${formatUsdAmount(depositAmt)} USDC (currently available ${formatUsdAmount(avail)}). Confirm in your wallet.`,
        'warning'
      );
      await depositTradingVault(depositAmt);
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 600));
        avail = await readVaultAvailableUsdc(walletAddr);
        if (avail >= requiredUsdc - 1e-6) break;
      }
      lastVaultFpRef.current = '';
      await refreshVault();
      if (avail < requiredUsdc - 1e-6) {
        await new Promise((r) => setTimeout(r, 1200));
        avail = await readVaultAvailableUsdc(walletAddr);
      }
      if (avail < requiredUsdc - 1e-6) {
        showNotification(
          'Vault is still short for this order after deposit. Wait for block confirmation or add more USDC, then try again.',
          'error'
        );
        return false;
      }
      return true;
    },
    [readVaultAvailableUsdc, refreshVault, showNotification]
  );

  const refreshBook = useCallback(async () => {
    if (!chainMarketId || !optionKey) return;
    try {
      const { data } = await api.get(`/orderbook/book/${chainMarketId}`, {
        params: { optionKey, side },
      });
      const next = data || { bids: [], asks: [] };
      const fp = fingerprintSideBook(next);
      if (lastBookFpRef.current === fp) return;
      lastBookFpRef.current = fp;
      setBook(next);
    } catch {
      const empty = { bids: [], asks: [] };
      lastBookFpRef.current = '';
      setBook(empty);
    }
  }, [chainMarketId, optionKey, side]);

  useEffect(() => {
    refreshVault();
    const t = setInterval(refreshVault, 8000);
    return () => clearInterval(t);
  }, [refreshVault]);

  useEffect(() => {
    if (vaultRefreshNonce > 0) refreshVault();
  }, [vaultRefreshNonce, refreshVault]);

  useEffect(() => {
    refreshBook();
    const t = setInterval(refreshBook, 8000);
    return () => clearInterval(t);
  }, [refreshBook]);

  const bestBidPx = book.bids?.[0]?.limitPrice;
  const bestAskPx = book.asks?.[0]?.limitPrice;
  const bookEmptyForMarket =
    orderKind === 'market' &&
    (direction === 'buy' ? !book.asks?.length : !book.bids?.length);

  const referencePrice = useMemo(() => {
    if (orderKind === 'limit') {
      const p = parseFloat(limitPrice);
      return Number.isFinite(p) && p > 0 ? p : null;
    }
    if (direction === 'buy') {
      const a = parseFloat(bestAskPx);
      return Number.isFinite(a) ? a : null;
    }
    const b = parseFloat(bestBidPx);
    return Number.isFinite(b) ? b : null;
  }, [orderKind, limitPrice, direction, bestAskPx, bestBidPx]);

  /** For share/USDC preview when the CLOB is still empty (market orders still need real quotes to execute). */
  const sizingHintPrice = useMemo(() => {
    if (referencePrice != null) return referencePrice;
    if (orderKind === 'market' && bookEmptyForMarket) return 0.5;
    return null;
  }, [referencePrice, orderKind, bookEmptyForMarket]);

  useEffect(() => {
    if (sizeInputMode !== 'usdc') return;
    const px = sizingHintPrice;
    if (px == null || !Number.isFinite(px) || px <= 0) return;
    const u = parseFloat(usdcNotional);
    if (!Number.isFinite(u) || u <= 0) {
      setSize('');
      return;
    }
    const sh = u / px;
    setSize(sh >= 1e-8 ? trimDecimalString(sh, 10) : '');
  }, [usdcNotional, sizingHintPrice, sizeInputMode]);

  const derivedUsdcFromShares = useMemo(() => {
    const sh = parseFloat(size);
    const px = sizingHintPrice;
    if (!Number.isFinite(sh) || sh <= 0 || px == null) return null;
    return sh * px;
  }, [size, sizingHintPrice]);

  const derivedSharesFromUsdc = useMemo(() => {
    const u = parseFloat(usdcNotional);
    const px = sizingHintPrice;
    if (!Number.isFinite(u) || u <= 0 || px == null || px <= 0) return null;
    return u / px;
  }, [usdcNotional, sizingHintPrice]);

  const effectiveShares = useMemo(() => {
    const sh = parseFloat(size);
    if (Number.isFinite(sh) && sh > 0) return sh;
    return derivedSharesFromUsdc;
  }, [size, derivedSharesFromUsdc]);

  const potentialWinPreview = useMemo(() => {
    if (sizingHintPrice == null || !(effectiveShares > 0)) return null;
    return estimateMarketOrderbookPotentialWin({
      direction,
      shares: effectiveShares,
      price: sizingHintPrice,
      feeRate: takerFeeRate,
    });
  }, [direction, effectiveShares, sizingHintPrice, takerFeeRate]);

  const contractMismatch =
    vaultInfo?.contractAddress &&
    process.env.REACT_APP_CONTRACT_ADDRESS &&
    String(vaultInfo.contractAddress).toLowerCase() !== String(process.env.REACT_APP_CONTRACT_ADDRESS).toLowerCase();

  const handleOrderKindChange = useCallback(
    (e) => {
      const next = e.target.value;
      if (next === 'limit' && orderKind === 'market') {
        const bb = parseFloat(book.bids?.[0]?.limitPrice);
        const ba = parseFloat(book.asks?.[0]?.limitPrice);
        if (direction === 'buy') {
          let safe;
          if (Number.isFinite(ba)) {
            const cents = Math.round(ba * 100);
            safe = Math.max(0.01, (cents - 1) / 100);
            if (safe >= ba - 1e-9) safe = Math.max(0.01, parseFloat((ba - 0.001).toFixed(3)));
          }
          if (!Number.isFinite(safe)) {
            safe = Number.isFinite(bb) ? bb : 0.49;
          }
          setLimitPrice(trimDecimalString(safe, 4));
        } else {
          let safe;
          if (Number.isFinite(bb)) {
            const cents = Math.floor(bb * 100);
            safe = Math.min(0.99, (cents + 1) / 100);
            if (safe <= bb + 1e-9) safe = Math.min(0.99, parseFloat((bb + 0.001).toFixed(3)));
          }
          if (!Number.isFinite(safe)) {
            safe = Number.isFinite(ba) ? ba : 0.51;
          }
          setLimitPrice(trimDecimalString(safe, 4));
        }
      }
      setOrderKind(next);
    },
    [orderKind, book, direction]
  );

  const onPlaceOrder = async () => {
    if (locked) {
      showNotification('Trading locked', 'error');
      return;
    }
    if (!user) {
      showNotification('Login to trade', 'warning');
      return;
    }
    if (direction === 'buy' && isNewBuysPaused(itemData?.orderbook, optionKey, side)) {
      showNotification(
        pauseLabel(itemData?.orderbook, optionKey, side, { itemData, isPoll }) ||
          'This side is paused for new buys',
        'warning'
      );
      return;
    }
    if (orderKind === 'market') {
      const hasLiquidity =
        direction === 'buy' ? (book.asks?.length || 0) > 0 : (book.bids?.length || 0) > 0;
      if (!hasLiquidity || referencePrice == null) {
        showNotification(
          'No active market orders on this side — use a limit order or wait for market-maker quotes.',
          'warning'
        );
        return;
      }
    }
    const sz = parseFloat(size);
    if (!Number.isFinite(sz) || sz <= 0) {
      showNotification('Enter a valid size', 'warning');
      return;
    }
    if (orderKind === 'limit') {
      const p = parseFloat(limitPrice);
      if (!Number.isFinite(p) || p < 0.01 || p > 0.99) {
        showNotification('Limit price must be between 0.01 and 0.99', 'warning');
        return;
      }
    }
    if (expiryEnabled && resolveExpiryHours() == null) {
      showNotification('Choose a valid order expiry (or turn expiry off)', 'warning');
      return;
    }

    setSubmitting(true);
    let addr = null;
    const payload = () => ({
      walletAddress: addr,
      matchId: matchId != null && matchId !== '' ? String(matchId) : undefined,
      pollId: pollId != null && pollId !== '' ? String(pollId) : undefined,
      optionKey,
      side,
      direction,
      orderKind,
      limitPrice: orderKind === 'market' ? undefined : parseFloat(limitPrice),
      size: sz,
      slippageBps: parseInt(slippageBps, 10) || 100,
      expiresAt: expiresAtIso,
    });

    const finishSuccess = (placed, orderKindHint = orderKind) => {
      const filled = Number(placed?.sizeFilled) || 0;
      const remaining = Number(placed?.sizeRemaining) || 0;
      const st = String(placed?.status || '').toLowerCase();
      if (st === 'open' && remaining > 1e-6 && filled <= 1e-9) {
        showNotification('Limit order placed on the book', 'success');
      } else if (remaining > 1e-6 && filled > 0) {
        showNotification(
          `Partial fill — ${filled.toFixed(4)} shares filled, remainder settling…`,
          'info'
        );
      } else if (st === 'filled' || filled > 0) {
        showNotification(
          filled > 0 ? `Filled ${filled.toFixed(4)} shares` : 'Order filled',
          'success'
        );
      } else if (orderKindHint === 'market') {
        showNotification('Order placed — settling…', 'success');
      } else {
        showNotification('Order placed', 'success');
      }
      setSize('');
      setUsdcNotional('');
      lastBookFpRef.current = '';
      lastVaultFpRef.current = '';
      refreshVault().catch(() => {});
      refreshBook().catch(() => {});
      if (typeof onOrderPlaced === 'function') {
        onOrderPlaced({ force: true, order: placed });
      }
    };

    const showOrderError = (e) => {
      const data = e?.response?.data;
      const code = data?.code;
      const msg = data?.message || e?.message || 'Order failed';
      if (code === 'NO_LIQUIDITY' || /no active market orders|no liquidity/i.test(msg)) {
        showNotification(
          'No active market orders on this side — use a limit order or wait for quotes.',
          'warning'
        );
      } else {
        showNotification(msg, 'error');
      }
    };

    const postOrder = () =>
      withTimeout(api.post('/orderbook/orders', payload()), ORDER_POST_TIMEOUT_MS, 'ORDER_TIMEOUT');

    try {
      addr = await ensureLinkedWallet();

      // Limit orders: post first (fast path). Market buys: fund vault only when needed.
      if (direction === 'buy' && orderKind === 'market') {
        const slip = (parseInt(slippageBps, 10) || 100) / 10000;
        const requiredUsdc = sz * Math.min(0.99, Number(referencePrice) * (1 + slip));
        const funded = await ensureBuyVaultFunded(addr, requiredUsdc);
        if (!funded) return;
      }

      try {
        const { data: placed } = await postOrder();
        finishSuccess(placed);
      } catch (e) {
        if (String(e?.message || '') === 'ORDER_TIMEOUT') {
          showNotification('Order sent — check Settling below', 'info');
          finishSuccess({ status: 'pending', sizeFilled: 0, sizeRemaining: sz }, orderKind);
          return;
        }
        const data = e?.response?.data;
        if (data?.code === 'INSUFFICIENT_VAULT' && data.details && direction === 'buy' && addr) {
          const req = Number(data.details.requiredUsdc) || 0;
          const funded = await ensureBuyVaultFunded(addr, req);
          if (!funded) return;
          const { data: placed } = await postOrder();
          finishSuccess(placed);
          return;
        }
        showOrderError(e);
      }
    } catch (e) {
      if (String(e?.message || '') === 'ORDER_TIMEOUT') {
        showNotification('Order sent — check Settling below', 'info');
        finishSuccess({ status: 'pending', sizeFilled: 0, sizeRemaining: sz }, orderKind);
        return;
      }
      showOrderError(e);
    } finally {
      setSubmitting(false);
    }
  };

  if (!chainMarketId) return null;
  if (!outcomeChoices.length) {
    return (
      <div className="mb-6 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-sm text-amber-800 dark:text-amber-200">
        Add poll options before orderbook trading is available.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {contractMismatch && (
        <div className="text-xs p-2 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100">
          Backend contract ({String(vaultInfo.contractAddress).slice(0, 10)}…) differs from this app&apos;s{' '}
          {String(process.env.REACT_APP_CONTRACT_ADDRESS).slice(0, 10)}… — vault reads may show $0. Align{' '}
          <code className="text-[10px]">CONTRACT_ADDRESS</code> in backend <code className="text-[10px]">.env</code> with the
          frontend.
        </div>
      )}

      {user && account && (
        <div className="text-xs space-y-3 text-slate-600 dark:text-slate-300">
          <div className="space-y-1">
            <div className="flex justify-between gap-2">
              <span>
                Vault (on-chain)
                {vaultInfo?.vaultReadFromWallet ? (
                  <span className="font-normal text-slate-400 dark:text-slate-500"> · wallet RPC</span>
                ) : null}
              </span>
              <span className="tabular-nums">
                {vaultInfo == null ? '…' : formatUsdAmount(vaultInfo.onChainVaultUsdc ?? 0)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span title="USDC held for open buy orders (same rules as the matcher)">Reserved</span>
              <span className="tabular-nums">
                {vaultInfo == null || vaultInfo.reservedLoading
                  ? '…'
                  : formatUsdAmount(vaultInfo.reservedUsdc ?? 0)}
              </span>
            </div>
            <div className="flex justify-between gap-2 font-medium">
              <span>Withdrawable</span>
              <span className="tabular-nums">
                {vaultInfo == null || vaultInfo.reservedLoading
                  ? '…'
                  : formatUsdAmount(vaultInfo.availableUsdc ?? 0)}
              </span>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">Direction</div>
            <div className="flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden p-0.5 bg-white dark:bg-slate-800/80">
              <button
                type="button"
                title={buysPaused ? pauseNotice || 'New buys paused on this side' : undefined}
                className={`flex-1 min-h-[40px] text-sm font-semibold rounded-md transition-colors ${
                  direction === 'buy'
                    ? buysPaused
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-emerald-600 text-white shadow-sm'
                    : buysPaused
                      ? 'text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
                onClick={() => setDirection('buy')}
              >
                {buysPaused ? 'Buy (paused)' : 'Buy'}
              </button>
              <button
                type="button"
                className={`flex-1 min-h-[40px] text-sm font-semibold rounded-md transition-colors ${
                  direction === 'sell'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                }`}
                onClick={() => setDirection('sell')}
              >
                Sell
              </button>
            </div>
          </div>
        </div>
      )}

      {(!user || !account) && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Connect a wallet to fund your vault and trade. Placing an order will prompt you to connect if needed.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        {!hideOutcomeSelector ? (
          <>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 mb-1">Outcome</label>
              <select
                className="w-full px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white text-sm"
                value={optionKey}
                onChange={(e) => {
                  const v = e.target.value;
                  setOptionKey(v);
                  onChangeOptionKey && onChangeOptionKey(v);
                }}
              >
                {outcomeChoices.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 mb-1">Token side</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600">
                {['YES', 'NO'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`flex-1 py-2 text-xs font-medium ${
                      side === s ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                    onClick={() => {
                      setSide(s);
                      onChangeSide && onChangeSide(s);
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="sm:col-span-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
            <div className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate pr-2">{selectedOutcomeLabel}</div>
            <div className="flex rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 shrink-0">
              {['YES', 'NO'].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wide ${
                    side === s
                      ? s === 'YES'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-rose-600 text-white'
                      : s === 'YES'
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                        : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
                  }`}
                  onClick={() => {
                    setSide(s);
                    onChangeSide && onChangeSide(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Order type</label>
        <select
          className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white text-sm font-medium"
          value={orderKind}
          onChange={handleOrderKindChange}
        >
          <option value="limit">Limit — set your price (0.01–0.99)</option>
          <option value="market">Market — match the best resting quote</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {orderKind === 'limit' && (
          <div className="sm:col-span-2">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Limit price (0.01–0.99)</label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white text-sm"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0.01 – 0.99"
            />
          </div>
        )}
        {orderKind === 'market' && (
          <div className="sm:col-span-2 space-y-1.5">
            <label className="block text-xs text-slate-500 dark:text-slate-400">Market price</label>
            <input
              readOnly
              disabled
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 text-sm tabular-nums cursor-not-allowed opacity-95"
              value={referencePrice != null ? trimDecimalString(Number(referencePrice), 6) : ''}
              placeholder="—"
            />
            {referencePrice != null ? (
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Best {direction === 'buy' ? 'ask' : 'bid'} · slippage cap {slippageBps} bps
              </p>
            ) : (
              <div className="text-xs text-amber-800 dark:text-amber-200/90 space-y-1 rounded-lg border border-amber-200/70 dark:border-amber-800/50 bg-amber-50/80 dark:bg-amber-950/30 px-3 py-2">
                <p>No resting {direction === 'buy' ? 'asks' : 'bids'} for this outcome yet.</p>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  Try a limit order or wait for quotes. Book still updates in the background.
                </p>
              </div>
            )}
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Size input</label>
          <div className="flex rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 text-xs divide-x divide-slate-300 dark:divide-slate-600 shadow-sm dark:shadow-none">
            <button
              type="button"
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                sizeInputMode === 'shares'
                  ? 'bg-slate-700 dark:bg-slate-500 text-white'
                  : 'bg-slate-50 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700/70'
              }`}
              onClick={() => {
                setSizeInputMode('shares');
                if (derivedSharesFromUsdc != null) setSize(trimDecimalString(derivedSharesFromUsdc, 10));
              }}
            >
              Shares
            </button>
            <button
              type="button"
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                sizeInputMode === 'usdc'
                  ? 'bg-slate-700 dark:bg-slate-500 text-white'
                  : 'bg-slate-50 dark:bg-slate-800/90 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700/70'
              }`}
              onClick={() => {
                setSizeInputMode('usdc');
                if (derivedUsdcFromShares != null) setUsdcNotional(trimDecimalString(derivedUsdcFromShares, 8));
              }}
            >
              USDC
            </button>
          </div>
        </div>
        {sizeInputMode === 'shares' ? (
          <div className="sm:col-span-2">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Size (shares)</label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white text-sm"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="e.g. 10 or 10.5"
              inputMode="decimal"
            />
            {derivedUsdcFromShares != null && (
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                ≈ {formatUsdAmount(derivedUsdcFromShares)} notional @{' '}
                {sizingHintPrice != null ? trimDecimalString(Number(sizingHintPrice), 6) : '—'}
                {bookEmptyForMarket && orderKind === 'market' && (
                  <span className="text-amber-700 dark:text-amber-300"> (provisional 0.50 — book empty)</span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="sm:col-span-2">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">USDC notional</label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white text-sm"
              value={usdcNotional}
              onChange={(e) => setUsdcNotional(e.target.value)}
              placeholder="e.g. 25 or 25.5"
              inputMode="decimal"
            />
            {derivedSharesFromUsdc != null && sizingHintPrice != null && (
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                ≈ {trimDecimalString(derivedSharesFromUsdc, 8)} shares @{' '}
                {sizingHintPrice != null ? trimDecimalString(Number(sizingHintPrice), 6) : '—'}
                {bookEmptyForMarket && orderKind === 'market' && (
                  <span className="text-amber-700 dark:text-amber-300"> (provisional — book empty)</span>
                )}
              </div>
            )}
          </div>
        )}
        {orderKind === 'market' && (
          <div className="sm:col-span-2">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Slippage (bps)</label>
            <input
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white text-sm"
              value={slippageBps}
              onChange={(e) => setSlippageBps(e.target.value)}
            />
          </div>
        )}
        <div className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/30 px-3 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200">Order expiry</span>
            <button
              type="button"
              role="switch"
              aria-checked={expiryEnabled}
              onClick={() => setExpiryEnabled((v) => !v)}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                expiryEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition ${
                  expiryEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
                style={{ marginTop: 1 }}
              />
            </button>
          </div>
          {expiryEnabled && (
            <div className="space-y-2 pt-1">
              <label className="block text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Duration</label>
              <select
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white text-sm"
                value={expiryPreset}
                onChange={(e) => setExpiryPreset(e.target.value)}
              >
                <option value="5">5 hours</option>
                <option value="24">24 hours</option>
                <option value="72">3 days</option>
                <option value="168">7 days</option>
                <option value="custom">Custom (hours)</option>
              </select>
              {expiryPreset === 'custom' && (
                <input
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white text-sm"
                  placeholder="Hours"
                  value={expiryCustomHours}
                  onChange={(e) => setExpiryCustomHours(e.target.value)}
                  inputMode="decimal"
                />
              )}
            </div>
          )}
        </div>
      </div>

      {potentialWinPreview != null && potentialWinPreview > 0 && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/90 dark:bg-emerald-950/25 px-3 py-2.5">
          <div className="text-[11px] uppercase tracking-wide text-emerald-800/80 dark:text-emerald-300/90 font-semibold">
            Potential win (if this side wins)
          </div>
          <div className="text-lg font-bold tabular-nums text-emerald-800 dark:text-emerald-200 mt-0.5">
            {formatUsdAmount(potentialWinPreview)}
          </div>
          <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 leading-snug">
            Assumes resolution pays $1 per share on your {side} token. Based on size × price and taker fee.
          </p>
        </div>
      )}

      {locked && (
        <div className="rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
          Trading is locked for this market (admin status or lock time reached).
        </div>
      )}

      {pauseNotice && direction === 'buy' && !locked && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {pauseNotice}
        </div>
      )}

      <button
        type="button"
        disabled={submitting || locked || (direction === 'buy' && buysPaused)}
        onClick={onPlaceOrder}
        className={`w-full min-h-[44px] py-2.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50 ${
          direction === 'sell' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
        }`}
      >
        {submitting
          ? 'Submitting…'
          : locked
            ? 'Trading locked'
            : direction === 'buy' && buysPaused
              ? 'Buy paused'
              : direction === 'sell'
                ? 'Sell'
                : 'Buy'}
      </button>
    </div>
  );
}
