import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWallet } from '../context/WalletContext';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { getWalletBalance, getUsdcBalance, transferUsdc } from '../utils/blockchain';
import { useNotification } from '../components/Notification';
import { ethers } from 'ethers';
import { formatUsdAmount } from '../utils/money';
import { formatMarketOrderbookOutcomeLabel } from '../utils/marketLabels';

function formatOrderbookOrderStatusLabel(statusRaw) {
  const s = String(statusRaw ?? '')
    .toLowerCase()
    .trim();
  if (!s) return { label: '—', filled: false };
  if (s === 'filled') return { label: 'Filled', filled: true };
  const label = s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { label, filled: false };
}

function normalizeTradeOrderStatus(orderDoc) {
  const raw = orderDoc && Object.prototype.hasOwnProperty.call(orderDoc, 'status') ? orderDoc.status : '';
  return String(raw ?? '')
    .toLowerCase()
    .trim();
}

function isOrderbookMarketResolved(matchDoc, pollDoc) {
  if (matchDoc?.isResolved) return true;
  if (pollDoc?.isResolved) return true;
  const ms = String(matchDoc?.status || '').toLowerCase();
  if (ms === 'completed' || ms === 'settled') return true;
  const ps = String(pollDoc?.status || '').toLowerCase();
  if (ps === 'settled' || ps === 'completed') return true;
  return false;
}

function OrderbookPaginator({ page, total, pageSize, setPage, className = '' }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className={`flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 ${className}`}>
      <span>
        Page {page} of {pages} · {total} total
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 dark:text-gray-200 disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() =>
            setPage((p) => {
              const maxP = Math.max(1, Math.ceil(total / pageSize));
              return Math.min(maxP, p + 1);
            })
          }
          className="px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 dark:text-gray-200 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

const Profile = () => {
  const { user, checkAuth } = useAuth();
  const { account, connect, ensureConnected, isBaseSepolia } = useWallet();
  const { showNotification } = useNotification();
  const navigate = useNavigate();
  const [profileData, setProfileData] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [positions, setPositions] = useState([]);
  const [booksCache, setBooksCache] = useState({}); // key: `${chainMarketId}|${optionKey}|${side}` => { bids, asks }
  const [loading, setLoading] = useState(true);
  const [ethBalance, setEthBalance] = useState('0'); // Base ETH (gas token)
  const [usdcBalance, setUsdcBalance] = useState('0');
  const [filterType, setFilterType] = useState('all'); // 'all', 'free', 'boost', 'market'
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'pending', 'won', 'lost', 'settled'
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameValue, setUsernameValue] = useState('');
  const [usernameStatus, setUsernameStatus] = useState(null); // null | 'checking' | 'available' | 'taken' | 'invalid'
  const [usernameMessage, setUsernameMessage] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const usernameCheckTimeoutRef = React.useRef(null);

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [transferToken, setTransferToken] = useState('USDC'); // USDC | ETH
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [sendingTransfer, setSendingTransfer] = useState(false);

  const [marketBookTab, setMarketBookTab] = useState('active');
  const [activePosPage, setActivePosPage] = useState(1);
  const [activeOrdPage, setActiveOrdPage] = useState(1);
  const [historyOrdPage, setHistoryOrdPage] = useState(1);
  const orderbookPageSize = 5;
  const [closingOrderbookPosId, setClosingOrderbookPosId] = useState(null);
  const [cancelingProfileOrderId, setCancelingProfileOrderId] = useState(null);
  const [ticketBalances, setTicketBalances] = useState(null);
  const profileFetchGenRef = React.useRef(0);

  const clearProfileTradingState = useCallback(() => {
    setOrders([]);
    setPositions([]);
    setBooksCache({});
  }, []);

  const fetchTicketBalances = useCallback(async () => {
    try {
      const { data } = await api.get('/tickets/balances');
      setTicketBalances(data);
    } catch {
      setTicketBalances(null);
    }
  }, []);

  const fetchProfileData = useCallback(async () => {
    const requestUserId = user?._id != null ? String(user._id) : null;
    if (!requestUserId) {
      clearProfileTradingState();
      setPredictions([]);
      setProfileData(null);
      setLoading(false);
      return;
    }

    const fetchGen = ++profileFetchGenRef.current;
    try {
      const [profileRes, predictionsRes, ordersRes, positionsRes] = await Promise.all([
        api.get('/users/profile'),
        api.get('/predictions/user'),
        api.get('/orderbook/orders/mine').catch(() => ({ data: [] })),
        api.get('/orderbook/positions/mine/all').catch(() => ({ data: { rows: [] } })),
      ]);

      if (fetchGen !== profileFetchGenRef.current) return;

      setProfileData(profileRes.data);
      setPredictions(predictionsRes.data || []);
      setOrders(ordersRes.data || []);
      setPositions(positionsRes.data?.rows || []);
    } catch (error) {
      if (fetchGen !== profileFetchGenRef.current) return;
      console.error('Error fetching profile data:', error);
      clearProfileTradingState();
    } finally {
      if (fetchGen === profileFetchGenRef.current) setLoading(false);
    }
  }, [user?._id, clearProfileTradingState]);

  useEffect(() => {
    if (!user) {
      clearProfileTradingState();
      setPredictions([]);
      setProfileData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    clearProfileTradingState();
    fetchProfileData();
    fetchTicketBalances();
  }, [user, fetchProfileData, fetchTicketBalances, clearProfileTradingState]);

  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      fetchProfileData();
    }, 15000);
    const onVis = () => {
      if (document.visibilityState === 'visible') fetchProfileData();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user, fetchProfileData]);

  useEffect(() => {
    const fetchBalances = async () => {
      if (account) {
        try {
          const [eth, usdc] = await Promise.all([
            getWalletBalance(account),
            getUsdcBalance(account),
          ]);
          setEthBalance(eth || '0');
          setUsdcBalance(usdc || '0');
        } catch (error) {
          console.error('Error fetching balances:', error);
        }
      } else {
        setEthBalance('0');
        setUsdcBalance('0');
      }
    };
    fetchBalances();
  }, [account]);

  const resetTransferForm = () => {
    setTransferToken('USDC');
    setTransferTo('');
    setTransferAmount('');
    setSendingTransfer(false);
  };

  const handleSendTransfer = async () => {
    if (!account) {
      showNotification('Please connect your wallet first', 'warning');
      return;
    }
    const to = String(transferTo || '').trim();
    const amt = String(transferAmount || '').trim();
    if (!to || !ethers.isAddress(to)) {
      showNotification('Enter a valid recipient address', 'warning');
      return;
    }
    const amountNum = parseFloat(amt);
    if (Number.isNaN(amountNum) || amountNum <= 0) {
      showNotification('Enter a valid amount', 'warning');
      return;
    }
    setSendingTransfer(true);
    try {
      await ensureConnected();
      if (!isBaseSepolia) {
        showNotification('Please switch your wallet to Base Sepolia (Base chain) to transfer', 'warning');
        return;
      }

      let txHash = '';
      if (transferToken === 'ETH') {
        if (typeof window.ethereum === 'undefined') {
          showNotification('No wallet provider found', 'error');
          return;
        }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const tx = await signer.sendTransaction({
          to,
          value: ethers.parseEther(amt),
        });
        txHash = tx.hash;
        showNotification(`Transfer sent! TX: ${txHash.slice(0, 10)}...`, 'success');
        await tx.wait();
      } else {
        txHash = await transferUsdc(to, amt);
        showNotification(`Transfer sent! TX: ${txHash.slice(0, 10)}...`, 'success');
      }

      try {
        await api.post('/transactions', {
          action: transferToken === 'ETH' ? 'wallet_transfer_eth' : 'wallet_transfer_usdc',
          txHash,
          amount: amountNum,
          currency: transferToken,
          itemType: 'none',
          meta: { to },
        });
      } catch {
        // ignore
      }

      showNotification('Transfer confirmed on-chain', 'success');
      setShowTransferModal(false);
      resetTransferForm();
      // refresh balances
      const [eth, usdc] = await Promise.all([
        getWalletBalance(account),
        getUsdcBalance(account),
      ]);
      setEthBalance(eth || '0');
      setUsdcBalance(usdc || '0');
    } catch (err) {
      console.error('Transfer failed:', err);
      showNotification(err?.shortMessage || err?.message || 'Transfer failed', 'error');
    } finally {
      setSendingTransfer(false);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showNotification('Copied to clipboard', 'success');
    } catch {
      showNotification('Could not copy. Please copy manually.', 'warning');
    }
  };

  // Reset to page 1 when filters change (must be before early returns)
  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, filterStatus]);

  const getBookMid = (book) => {
    const bestBid = book?.bids?.length ? Number(book.bids[0].limitPrice) : null;
    const bestAsk = book?.asks?.length ? Number(book.asks[0].limitPrice) : null;
    if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
    if (bestAsk != null) return bestAsk;
    if (bestBid != null) return bestBid;
    return null;
  };

  const displayOptionLabel = (optionKey, marketRef) => {
    const k = String(optionKey || '').trim();
    if (!k) return '—';
    if (marketRef?.teamA && marketRef?.teamB) {
      if (k === 'TeamA') return marketRef.teamA;
      if (k === 'TeamB') return marketRef.teamB;
      if (k === 'Draw') return 'Draw';
    }
    return k;
  };

  const ensureBookCached = async (chainMarketId, optionKey, side) => {
    const k = `${chainMarketId}|${optionKey}|${side}`;
    if (booksCache[k]) return booksCache[k];
    try {
      const { data } = await api.get(`/orderbook/book/${chainMarketId}`, { params: { optionKey, side } });
      setBooksCache((prev) => ({ ...prev, [k]: data || { bids: [], asks: [] } }));
      return data || { bids: [], asks: [] };
    } catch {
      const empty = { bids: [], asks: [] };
      setBooksCache((prev) => ({ ...prev, [k]: empty }));
      return empty;
    }
  };

  const activeOrderbookOrders = useMemo(() => {
    return (orders || []).filter((o) => {
      const st = normalizeTradeOrderStatus(o);
      return ['open', 'partially_filled', 'pending'].includes(st);
    });
  }, [orders]);

  const historyOrderbookOrders = useMemo(() => {
    return (orders || [])
      .filter((o) => {
        const st = normalizeTradeOrderStatus(o);
        return ['filled', 'cancelled', 'expired', 'rejected'].includes(st);
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
      );
  }, [orders]);

  const activeOrderbookPositions = useMemo(() => {
    return (positions || []).filter((p) => Number(p.shares || 0) > 1e-9);
  }, [positions]);

  useEffect(() => {
    setActivePosPage(1);
    setActiveOrdPage(1);
    setHistoryOrdPage(1);
  }, [marketBookTab]);

  const checkUsernameAvailability = useCallback(async (value) => {
    const trimmed = value.trim();
    if (trimmed.length < 5) {
      setUsernameStatus('invalid');
      setUsernameMessage('Username must be more than 4 characters');
      return;
    }
    if (/\s/.test(value)) {
      setUsernameStatus('invalid');
      setUsernameMessage('Username cannot contain spaces');
      return;
    }
    setUsernameStatus('checking');
    setUsernameMessage('Checking...');
    try {
      const { data } = await api.get(`/users/check-username?username=${encodeURIComponent(trimmed)}`);
      setUsernameStatus(data.available ? 'available' : 'taken');
      setUsernameMessage(data.available ? 'Available' : (data.message || 'Username already taken'));
    } catch (err) {
      setUsernameStatus('invalid');
      setUsernameMessage(err.response?.data?.message || 'Could not check username');
    }
  }, []);

  useEffect(() => {
    if (!editingUsername) return;
    if (usernameCheckTimeoutRef.current) clearTimeout(usernameCheckTimeoutRef.current);
    if (!usernameValue.trim()) {
      setUsernameStatus(null);
      setUsernameMessage('');
      return;
    }
    usernameCheckTimeoutRef.current = setTimeout(() => {
      checkUsernameAvailability(usernameValue);
    }, 400);
    return () => {
      if (usernameCheckTimeoutRef.current) clearTimeout(usernameCheckTimeoutRef.current);
    };
  }, [editingUsername, usernameValue, checkUsernameAvailability]);

  const startEditUsername = () => {
    setEditingUsername(true);
    setUsernameValue(user?.username || '');
    setUsernameStatus(null);
    setUsernameMessage('');
  };

  const cancelEditUsername = () => {
    setEditingUsername(false);
    setUsernameValue('');
    setUsernameStatus(null);
    setUsernameMessage('');
  };

  const saveUsername = async () => {
    const trimmed = usernameValue.trim();
    if (trimmed.length < 5) {
      showNotification('Username must be more than 4 characters', 'warning');
      return;
    }
    if (/\s/.test(usernameValue)) {
      showNotification('Username cannot contain spaces', 'warning');
      return;
    }
    const isUnchanged = trimmed === (user?.username || '');
    if (!isUnchanged && (usernameStatus === 'taken' || usernameStatus === 'invalid')) {
      showNotification(usernameMessage || 'Please choose a valid username', 'warning');
      return;
    }
    if (isUnchanged) {
      cancelEditUsername();
      return;
    }
    setSavingUsername(true);
    try {
      await api.patch('/users/profile', { username: trimmed });
      showNotification('Username updated successfully', 'success');
      await checkAuth();
      setProfileData((prev) => prev ? { ...prev, username: trimmed } : null);
      cancelEditUsername();
    } catch (err) {
      showNotification(err.response?.data?.message || 'Failed to update username', 'error');
    } finally {
      setSavingUsername(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">Please login to view your profile</p>
      </div>
    );
  }

  const stats = profileData || {
    points: user.points || 0,
    streak: user.streak || 0,
    totalPredictions: user.totalPredictions || 0,
    correctPredictions: user.correctPredictions || 0,
    tickets: user.tickets || 0,
  };

  const winRate = stats.totalPredictions > 0 
    ? ((stats.correctPredictions / stats.totalPredictions) * 100).toFixed(1)
    : 0;

  const freePredictions = predictions.filter(p => p.type === 'free');
  const boostPredictions = predictions.filter(p => p.type === 'boost');
  const marketPredictions = predictions.filter(p => p.type === 'market');

  // Filter predictions
  const filteredPredictions = predictions.filter(p => {
    if (filterType !== 'all' && p.type !== filterType) return false;
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    return true;
  });

  // Pagination for filtered predictions
  const totalPages = Math.ceil(filteredPredictions.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedPredictions = filteredPredictions.slice(startIndex, endIndex);

  const handleRowClick = (prediction) => {
    if (prediction.match) {
      navigate(`/match/${prediction.match._id || prediction.match}/${prediction.type}`);
    } else if (prediction.poll) {
      navigate(`/poll/${prediction.poll._id || prediction.poll}/${prediction.type}`);
    }
  };

  const formatMatchOutcome = (match, rawResult) => {
    if (!rawResult) return '';
    const r = String(rawResult).trim();
    if (r === 'TeamA' && match.teamA) return match.teamA;
    if (r === 'TeamB' && match.teamB) return match.teamB;
    if (r === 'Draw') return 'Draw';
    return r;
  };

  const getPredictionLabel = (prediction) => {
    if (!prediction) return '';
    const raw = String(prediction.outcome || '').trim();
    const m = prediction.match;
    const p = prediction.poll;
    const itemData = m || p;
    const isPollItem = !!p && !m;
    if (itemData && (prediction.type === 'market' || raw.includes('|'))) {
      return formatMarketOrderbookOutcomeLabel(raw, itemData, isPollItem);
    }
    if (prediction.match) {
      return formatMatchOutcome(prediction.match, prediction.outcome);
    }
    return raw;
  };

  const getOutcome = (prediction) => {
    if (prediction.match) {
      const match = prediction.match;
      const resolved =
        match.isResolved === true ||
        match.status === 'completed' ||
        (!!match.result && String(match.result).trim() !== '');
      if (resolved && match.result) {
        return formatMatchOutcome(match, match.result);
      }
      return 'Not resolved';
    }
    if (prediction.poll) {
      const poll = prediction.poll;
      const resolved =
        poll.isResolved === true ||
        poll.status === 'settled' ||
        (!!poll.result && String(poll.result).trim() !== '');
      if (resolved && poll.result) {
        return String(poll.result).trim();
      }
      return 'Not resolved';
    }
    return 'N/A';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Profile Header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-4xl font-bold">
              {user.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              {!editingUsername ? (
                <div className="flex items-center gap-2 mb-2">
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                    {user.username}
                  </h1>
                  <button
                    type="button"
                    onClick={startEditUsername}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400 dark:hover:text-blue-400 transition-colors"
                    title="Edit username"
                    aria-label="Edit username"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={usernameValue}
                      onChange={(e) => setUsernameValue(e.target.value)}
                      placeholder="Username (5+ characters, no spaces)"
                      className="flex-1 min-w-[200px] px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      autoFocus
                      maxLength={30}
                    />
                    <button
                      type="button"
                      onClick={saveUsername}
                      disabled={savingUsername || (usernameValue.trim() !== (user?.username || '') && usernameStatus !== 'available')}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {savingUsername ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditUsername}
                      disabled={savingUsername}
                      className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                  {usernameMessage && (
                    <p className={`mt-1 text-sm ${
                      usernameStatus === 'available' ? 'text-green-600 dark:text-green-400' :
                      usernameStatus === 'taken' || usernameStatus === 'invalid' ? 'text-red-600 dark:text-red-400' :
                      'text-gray-500 dark:text-gray-400'
                    }`}>
                      {usernameMessage}
                    </p>
                  )}
                </div>
              )}
              {user.email && (
                <p className="text-gray-600 dark:text-gray-400 mb-2">{user.email}</p>
              )}
              {user.walletAddress && (
                <p className="text-sm text-gray-500 dark:text-gray-500 font-mono">
                  {user.walletAddress}
                </p>
              )}
            </div>
            <div className="md:text-right">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {stats.points} Points
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Points</div>
              {account ? (
                <div className="mt-2">
                  <div className="text-lg font-semibold text-green-600 dark:text-green-400">
                    {formatUsdAmount(usdcBalance || 0)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-500">USDC Balance</div>
                  <div className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
                    Gas (ETH): {parseFloat(ethBalance || 0).toFixed(6)} ETH
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowReceiveModal(true)}
                      className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                    >
                      Receive
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTransferModal(true)}
                      className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                    >
                      Transfer
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/wallet')}
                      className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                    >
                      View Wallet
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2">
                  <button
                    onClick={connect}
                    className="px-3 py-1 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    Connect Wallet
                  </button>
                  <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                    Connect to view balance
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Ticket balances */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-slate-200 dark:border-slate-700 p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-2xl shrink-0" aria-hidden>
              🪙
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Daily tickets
              </p>
              <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {ticketBalances?.normalTickets ?? stats.tickets ?? 0}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Resets daily · use on free predictions</p>
            </div>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/40 dark:to-gray-800 rounded-xl shadow-md border border-amber-200/80 dark:border-amber-800/60 p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center text-2xl shrink-0" aria-hidden>
              ⭐
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Golden tickets
              </p>
              <p className="text-2xl font-bold tabular-nums text-amber-900 dark:text-amber-100">
                {ticketBalances?.goldenTickets ?? 0}
              </p>
              <p className="text-xs text-amber-700/80 dark:text-amber-400/90 mt-0.5">Earned from boost stakes</p>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <StatCard
            title="Current Streak"
            value={`🔥 ${stats.streak}`}
            icon="⚡"
            color="orange"
          />
          <StatCard
            title="Win Rate"
            value={`${winRate}%`}
            icon="📊"
            color="green"
          />
          <StatCard
            title="Total Predictions"
            value={stats.totalPredictions}
            icon="🎯"
            color="blue"
          />
          <StatCard
            title="Correct Predictions"
            value={stats.correctPredictions}
            icon="✅"
            color="purple"
          />
        </div>

        {/* Prediction Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">FREE Predictions</h2>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Total</span>
                <span className="font-semibold text-gray-900 dark:text-white">{freePredictions.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Won</span>
                <span className="font-semibold text-green-600 dark:text-green-400">
                  {freePredictions.filter(p => p.status === 'won').length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Pending</span>
                <span className="font-semibold text-yellow-600 dark:text-yellow-400">
                  {freePredictions.filter(p => p.status === 'pending').length}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">BOOST Predictions</h2>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Total</span>
                <span className="font-semibold text-gray-900 dark:text-white">{boostPredictions.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Total Staked</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {boostPredictions.reduce((sum, p) => sum + (p.amount || 0), 0).toFixed(3)} USDC
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Total Payout</span>
                <span className="font-semibold text-green-600 dark:text-green-400">
                  {boostPredictions.reduce((sum, p) => sum + (p.payout || 0), 0).toFixed(3)} USDC
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">MARKET Predictions</h2>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Total</span>
                <span className="font-semibold text-gray-900 dark:text-white">{marketPredictions.length}</span>
              </div>
              {/* <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Total Volume</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {marketPredictions.reduce((sum, p) => sum + (p.amount || 0), 0).toFixed(3)} ETH
                </span>
              </div> */}
            </div>
          </div>
        </div>

        {/* Orderbook: positions + orders */}
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Market trading</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Active: current holdings and working orders. History: completed or cancelled orders. Syncs every 15s
                when this tab is open.
              </p>
            </div>
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 p-0.5 bg-gray-50 dark:bg-gray-900/50 shrink-0">
              <button
                type="button"
                onClick={() => setMarketBookTab('active')}
                className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                  marketBookTab === 'active'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setMarketBookTab('history')}
                className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
                  marketBookTab === 'history'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                History
              </button>
            </div>
          </div>

          {marketBookTab === 'active' &&
            activeOrderbookOrders.length === 0 &&
            activeOrderbookPositions.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">No active positions or orders.</p>
            )}

          {marketBookTab === 'active' &&
            (activeOrderbookOrders.length > 0 || activeOrderbookPositions.length > 0) && (
              <div className="space-y-6">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Positions</div>
                  <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700/80">
                    <table className="min-w-full text-sm text-gray-900 dark:text-gray-100">
                      <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40">
                          <th className="py-2.5 pr-4 pl-1">Market</th>
                          <th className="py-2.5 pr-4">Side</th>
                          <th className="py-2.5 pr-4">Qty</th>
                          <th className="py-2.5 pr-4">Avg</th>
                          <th className="py-2.5 pr-4">Current</th>
                          <th className="py-2.5 pr-4">PnL</th>
                          <th className="py-2.5 pr-1">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700/80">
                        {activeOrderbookPositions
                          .slice(
                            (activePosPage - 1) * orderbookPageSize,
                            activePosPage * orderbookPageSize
                          )
                          .map((p) => {
                            const [optionKey, side] = String(p.positionKey || '').split('|');
                            const label =
                              p.match && p.match.teamA
                                ? `${p.match.teamA} vs ${p.match.teamB}`
                                : p.poll?.question || 'Market';
                            const href = p.match
                              ? `/match/${p.match._id}/market`
                              : p.poll
                                ? `/poll/${p.poll._id}/market`
                                : '#';
                            const avg =
                              Number(p.totalInvested || 0) > 0 && Number(p.shares || 0) > 0
                                ? Number(p.totalInvested) / Number(p.shares)
                                : null;
                            const cacheKey = `${p.chainMarketId}|${optionKey}|${side}`;
                            const mid = getBookMid(booksCache[cacheKey]);
                            const pnl = mid != null && avg != null ? (mid - avg) * Number(p.shares || 0) : null;
                            const resolvedBook = isOrderbookMarketResolved(p.match, p.poll);
                            return (
                              <tr
                                key={p._id}
                                className="border-b border-gray-100 dark:border-gray-700/60 last:border-0 cursor-pointer hover:bg-gray-50/90 dark:hover:bg-gray-900/40"
                                onClick={() => href !== '#' && navigate(href)}
                              >
                                <td className="py-2.5 pr-4 pl-1 text-gray-900 dark:text-white font-medium">{label}</td>
                                <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200">
                                  {displayOptionLabel(optionKey, p.match)} · {side}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {Number(p.shares || 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {avg != null ? avg.toFixed(4) : '—'}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {mid != null ? (
                                    mid.toFixed(4)
                                  ) : (
                                    <button
                                      type="button"
                                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        await ensureBookCached(p.chainMarketId, optionKey, side);
                                      }}
                                    >
                                      Load
                                    </button>
                                  )}
                                </td>
                                <td
                                  className={`py-2.5 pr-4 tabular-nums ${
                                    pnl != null && pnl >= 0
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  {pnl != null ? formatUsdAmount(pnl) : '—'}
                                </td>
                                <td className="py-2.5 pr-1">
                                  {resolvedBook ? (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                                  ) : closingOrderbookPosId === String(p._id) ? (
                                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Closing…</span>
                                  ) : (
                                    <button
                                      type="button"
                                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline disabled:opacity-50 disabled:no-underline"
                                      disabled={!!closingOrderbookPosId}
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        setClosingOrderbookPosId(String(p._id));
                                        try {
                                          const addr = await ensureConnected();
                                          await api.post('/orderbook/orders', {
                                            walletAddress: addr,
                                            matchId: p.match?._id,
                                            pollId: p.poll?._id,
                                            optionKey,
                                            side,
                                            direction: 'sell',
                                            orderKind: 'market',
                                            size: Number(p.shares || 0),
                                            slippageBps: 150,
                                          });
                                          showNotification('Close order submitted', 'success');
                                          fetchProfileData();
                                        } catch (err) {
                                          showNotification(
                                            err?.response?.data?.message || err?.message || 'Close failed',
                                            'error'
                                          );
                                        } finally {
                                          setClosingOrderbookPosId(null);
                                        }
                                      }}
                                    >
                                      Close
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <OrderbookPaginator
                    page={activePosPage}
                    total={activeOrderbookPositions.length}
                    pageSize={orderbookPageSize}
                    setPage={setActivePosPage}
                    className="mt-2"
                  />
                </div>

                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Open orders</div>
                  <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700/80">
                    <table className="min-w-full text-sm text-gray-900 dark:text-gray-100">
                      <thead>
                        <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40">
                          <th className="py-2.5 pr-4 pl-1">Market</th>
                          <th className="py-2.5 pr-4">Option / side</th>
                          <th className="py-2.5 pr-4">Dir</th>
                          <th className="py-2.5 pr-4">Type</th>
                          <th className="py-2.5 pr-4">Shares</th>
                          <th className="py-2.5 pr-4">Filled</th>
                          <th className="py-2.5 pr-4">Price</th>
                          <th className="py-2.5 pr-4">Remaining</th>
                          <th className="py-2.5 pr-4">Status</th>
                          <th className="py-2.5 pr-4">Expires</th>
                          <th className="py-2.5 pr-1">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700/80">
                        {activeOrderbookOrders
                          .slice(
                            (activeOrdPage - 1) * orderbookPageSize,
                            activeOrdPage * orderbookPageSize
                          )
                          .map((o) => {
                            const label =
                              o.match && o.match.teamA
                                ? `${o.match.teamA} vs ${o.match.teamB}`
                                : o.poll?.question || 'Market';
                            const href = o.match
                              ? `/match/${o.match._id}/market`
                              : o.poll
                                ? `/poll/${o.poll._id}/market`
                                : '#';
                            return (
                              <tr
                                key={o._id}
                                className="border-b border-gray-100 dark:border-gray-700/60 last:border-0 cursor-pointer hover:bg-gray-50/90 dark:hover:bg-gray-900/40"
                                onClick={() => href !== '#' && navigate(href)}
                              >
                                <td className="py-2.5 pr-4 pl-1 text-gray-900 dark:text-white font-medium">{label}</td>
                                <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200">
                                  {displayOptionLabel(o.optionKey, o.match)} · {o.side}
                                </td>
                                <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200 capitalize">{o.direction}</td>
                                <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200 capitalize text-xs">
                                  {String(o.orderKind || 'limit')}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {Number(o.sizeOriginal ?? o.size ?? 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {Number(o.sizeFilled ?? 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {o.limitPrice != null ? Number(o.limitPrice).toFixed(3) : '—'}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {Number(o.sizeRemaining || 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300 text-xs">
                                  {(() => {
                                    const st = normalizeTradeOrderStatus(o);
                                    const { label: lab, filled } = formatOrderbookOrderStatusLabel(st);
                                    return filled ? (
                                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{lab}</span>
                                    ) : (
                                      <span>{lab}</span>
                                    );
                                  })()}
                                </td>
                                <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-400 text-xs tabular-nums">
                                  {o.expiresAt ? new Date(o.expiresAt).toLocaleString() : '—'}
                                </td>
                                <td className="py-2.5 pr-1">
                                  {['open', 'partially_filled', 'pending'].includes(normalizeTradeOrderStatus(o)) ? (
                                    cancelingProfileOrderId === String(o._id ?? o.id) ? (
                                      <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                                        Canceling…
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 hover:underline text-xs font-medium disabled:opacity-50 disabled:no-underline"
                                        disabled={!!cancelingProfileOrderId}
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          const oid = String(o._id ?? o.id);
                                          setCancelingProfileOrderId(oid);
                                          try {
                                            await api.delete(`/orderbook/orders/${encodeURIComponent(oid)}`);
                                            showNotification('Order cancelled', 'success');
                                            fetchProfileData();
                                          } catch (err) {
                                            showNotification(err.response?.data?.message || err.message, 'error');
                                          } finally {
                                            setCancelingProfileOrderId(null);
                                          }
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    )
                                  ) : (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <OrderbookPaginator
                    page={activeOrdPage}
                    total={activeOrderbookOrders.length}
                    pageSize={orderbookPageSize}
                    setPage={setActiveOrdPage}
                    className="mt-2"
                  />
                </div>
              </div>
            )}

          {marketBookTab === 'history' && historyOrderbookOrders.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No order history yet.</p>
          )}

          {marketBookTab === 'history' && historyOrderbookOrders.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Past orders</div>
              <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700/80">
                <table className="min-w-full text-sm text-gray-900 dark:text-gray-100">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40">
                      <th className="py-2.5 pr-4 pl-1">Market</th>
                      <th className="py-2.5 pr-4">Option / side</th>
                      <th className="py-2.5 pr-4">Dir</th>
                      <th className="py-2.5 pr-4">Type</th>
                      <th className="py-2.5 pr-4">Size</th>
                      <th className="py-2.5 pr-4">Filled</th>
                      <th className="py-2.5 pr-4">Price</th>
                      <th className="py-2.5 pr-4">Status</th>
                      <th className="py-2.5 pr-1">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700/80">
                    {historyOrderbookOrders
                      .slice(
                        (historyOrdPage - 1) * orderbookPageSize,
                        historyOrdPage * orderbookPageSize
                      )
                      .map((o) => {
                        const label =
                          o.match && o.match.teamA
                            ? `${o.match.teamA} vs ${o.match.teamB}`
                            : o.poll?.question || 'Market';
                        const href = o.match
                          ? `/match/${o.match._id}/market`
                          : o.poll
                            ? `/poll/${o.poll._id}/market`
                            : '#';
                        return (
                          <tr
                            key={o._id}
                            className="border-b border-gray-100 dark:border-gray-700/60 last:border-0 cursor-pointer hover:bg-gray-50/90 dark:hover:bg-gray-900/40"
                            onClick={() => href !== '#' && navigate(href)}
                          >
                            <td className="py-2.5 pr-4 pl-1 text-gray-900 dark:text-white font-medium">{label}</td>
                            <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200">
                              {displayOptionLabel(o.optionKey, o.match)} · {o.side}
                            </td>
                            <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200 capitalize">{o.direction}</td>
                            <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200 capitalize text-xs">
                              {String(o.orderKind || 'limit')}
                            </td>
                            <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                              {Number(o.sizeOriginal ?? 0).toFixed(4)}
                            </td>
                            <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                              {Number(o.sizeFilled ?? 0).toFixed(4)}
                            </td>
                            <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                              {o.limitPrice != null ? Number(o.limitPrice).toFixed(3) : '—'}
                            </td>
                            <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300 text-xs">
                              {(() => {
                                const st = normalizeTradeOrderStatus(o);
                                const { label: lab, filled } = formatOrderbookOrderStatusLabel(st);
                                return filled ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">{lab}</span>
                                ) : (
                                  <span>{lab}</span>
                                );
                              })()}
                            </td>
                            <td className="py-2.5 pr-1 text-gray-600 dark:text-gray-400 text-xs tabular-nums">
                              {o.updatedAt ? new Date(o.updatedAt).toLocaleString() : '—'}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              <OrderbookPaginator
                page={historyOrdPage}
                total={historyOrderbookOrders.length}
                pageSize={orderbookPageSize}
                setPage={setHistoryOrdPage}
                className="mt-2"
              />
            </div>
          )}
        </div>

        {/* Recent Predictions */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mt-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Recent Predictions</h2>
            <div className="flex gap-2">
              {/* Type Filter */}
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
              >
                <option value="all">All Types</option>
                <option value="free">Free</option>
                <option value="boost">Boost</option>
                <option value="market">Market</option>
              </select>
              {/* Status Filter */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="settled">Settled</option>
              </select>
            </div>
          </div>
          {filteredPredictions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Match/Poll</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Prediction</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Outcome</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedPredictions.map((prediction) => (
                    <tr 
                      key={prediction._id}
                      onClick={() => handleRowClick(prediction)}
                      className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          prediction.type === 'free' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                          prediction.type === 'boost' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                          'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                        }`}>
                          {prediction.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {prediction.match?.teamA && prediction.match?.teamB
                          ? `${prediction.match.teamA} vs ${prediction.match.teamB}`
                          : prediction.poll?.question || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {getPredictionLabel(prediction)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                        {getOutcome(prediction)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {prediction.type === 'free' 
                          ? '0.0000 ETH'
                          : prediction.type === 'boost'
                          ? `${(prediction.totalStake || prediction.amount || 0).toFixed(4)} ETH`
                          : prediction.type === 'market'
                          ? `${(prediction.totalInvested || 0).toFixed(4)} ETH`
                          : '0.0000 ETH'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          prediction.status === 'won' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                          prediction.status === 'lost' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                          prediction.status === 'settled' ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' :
                          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                        }`}>
                          {prediction.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {new Date(prediction.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-600 dark:text-gray-400">
              {predictions.length === 0 
                ? 'No predictions yet. Start predicting to see your history here!'
                : 'No predictions match the selected filters.'}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className={`px-4 py-2 rounded-lg font-medium ${
                  currentPage === 1
                    ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                Previous
              </button>
              <span className="text-gray-600 dark:text-gray-400">
                Page {currentPage} of {totalPages} ({filteredPredictions.length} total)
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className={`px-4 py-2 rounded-lg font-medium ${
                  currentPage === totalPages
                    ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="mt-6 flex space-x-4">
          <Link
            to="/leaderboard"
            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            View Leaderboard
          </Link>
          <Link
            to="/streaks"
            className="px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            View Streaks
          </Link>
          <Link
            to="/jackpot"
            className="px-6 py-3 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors"
          >
            View Jackpots
          </Link>
        </div>
      </div>

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 rounded">
                  Base chain
                </span>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Transfer</h3>
              </div>
              <button
                onClick={() => {
                  setShowTransferModal(false);
                  resetTransferForm();
                }}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Token
                </label>
                <select
                  value={transferToken}
                  onChange={(e) => setTransferToken(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="USDC">USDC</option>
                  <option value="ETH">ETH</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  To address
                </label>
                <input
                  type="text"
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  placeholder="0x..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Amount ({transferToken})
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step={transferToken === 'ETH' ? '0.0001' : '0.01'}
                  min="0"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder={transferToken === 'ETH' ? '0.01' : '10'}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <button
                type="button"
                onClick={handleSendTransfer}
                disabled={sendingTransfer}
                className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
              >
                {sendingTransfer ? 'Sending...' : 'Send'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTransferModal(false);
                  resetTransferForm();
                }}
                disabled={sendingTransfer}
                className="w-full py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Modal */}
      {showReceiveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 rounded">
                  Base chain
                </span>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Receive</h3>
              </div>
              <button
                onClick={() => setShowReceiveModal(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                aria-label="Close"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Your wallet address
              </p>
              <div className="flex items-center gap-2 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                <span className="flex-1 text-xs font-mono text-gray-900 dark:text-white break-all">
                  {account || 'Not connected'}
                </span>
                <button
                  type="button"
                  onClick={() => account && copyToClipboard(account)}
                  disabled={!account}
                  className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 disabled:opacity-50"
                  title="Copy"
                  aria-label="Copy address"
                >
                  <svg className="w-5 h-5 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-4 12h6a2 2 0 002-2v-8a2 2 0 00-2-2h-6a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowReceiveModal(false)}
                className="w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ title, value, icon, color }) => {
  const colorClasses = {
    orange: 'bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-400',
    green: 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400',
    blue: 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400',
    purple: 'bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400',
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{title}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
    </div>
  );
};

export default Profile;
