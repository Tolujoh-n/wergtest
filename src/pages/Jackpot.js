import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../components/Notification';
import { useWallet } from '../context/WalletContext';
import {
  withdrawJackpot,
  setContractAddress,
  getJackpotBalance,
} from '../utils/blockchain';

const Jackpot = () => {
  const [searchParams] = useSearchParams();
  const cupSlug = searchParams.get('cup');
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [jackpots, setJackpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, free, boost
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    hasNext: false,
    hasPrev: false
  });
  const [userStats, setUserStats] = useState({
    jackpotBalance: 0,
    jackpotWithdrawn: 0,
    jackpotWins: 0,
    totalEarned: 0,
  });
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const { account } = useWallet();
  
  // Set contract address on mount
  useEffect(() => {
    const contractAddr = process.env.REACT_APP_CONTRACT_ADDRESS;
    if (contractAddr) {
      setContractAddress(contractAddr);
    }
  }, []);

  const fetchJackpots = useCallback(async () => {
    setLoading(true);
    try {
      // Use new per-match/poll endpoint
      const page = pagination.currentPage || 1;
      const endpoint = `/jackpots/items?type=${filter}&page=${page}`;
      const response = await api.get(endpoint);
      if (response.data.items) {
        setJackpots(response.data.items || []);
        setPagination((prev) => response.data.pagination || prev);
      } else {
        setJackpots(response.data || []);
      }
    } catch (error) {
      console.error('Error fetching jackpots:', error);
      setJackpots([]);
    } finally {
      setLoading(false);
    }
  }, [filter, pagination.currentPage]);

  const fetchUserStats = useCallback(async () => {
    if (!user) {
      // Set default stats for non-logged in users
      setUserStats({
        jackpotBalance: 0,
        jackpotWithdrawn: 0,
        jackpotWins: 0,
        totalEarned: 0,
      });
      return;
    }
    try {
      const response = await api.get('/jackpots/user/stats');
      setUserStats(response.data || {
        jackpotBalance: 0,
        jackpotWithdrawn: 0,
        jackpotWins: 0,
        totalEarned: 0,
      });
    } catch (error) {
      console.error('Error fetching user stats:', error);
      // Set default stats on error
      setUserStats({
        jackpotBalance: 0,
        jackpotWithdrawn: 0,
        jackpotWins: 0,
        totalEarned: 0,
      });
    }
  }, [user]);

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) <= 0) {
      showNotification('Please enter a valid amount', 'warning');
      return;
    }
    
    if (parseFloat(withdrawAmount) > (userStats?.jackpotBalance || 0)) {
      showNotification('Insufficient balance', 'error');
      return;
    }
    
    if (!account) {
      showNotification('Please connect your wallet first', 'error');
      return;
    }
    
    // Wallet will auto-connect and switch network when blockchain function is called
    setWithdrawing(true);
    try {
      // Ensure contract balance is set (only deployer can set it, e.g. when admin resolves)
      const blockchainBalance = parseFloat(await getJackpotBalance(account));
      const backendBalance = userStats?.jackpotBalance || 0;
      if (backendBalance > 0 && blockchainBalance < backendBalance) {
        showNotification(
          'Your jackpot balance is not yet synced on-chain. Please wait for the admin to complete resolution, or contact support.',
          'error'
        );
        setWithdrawing(false);
        return;
      }

      // Withdraw from blockchain first
      const txHash = await withdrawJackpot(parseFloat(withdrawAmount));
      showNotification(`Withdrawal sent to blockchain! TX: ${txHash.slice(0, 10)}...`, 'success');
      
      // Then update backend
      await api.post('/jackpots/withdraw', { amount: withdrawAmount });
      showNotification('Withdrawal successful!', 'success');
      setWithdrawAmount('');
      await fetchUserStats();
    } catch (error) {
      console.error('Error withdrawing:', error);
      showNotification(error.message || 'Withdrawal failed', 'error');
    } finally {
      setWithdrawing(false);
    }
  };

  useEffect(() => {
    fetchJackpots();
  }, [cupSlug, filter, fetchJackpots]);

  useEffect(() => {
    fetchUserStats();
  }, [user, fetchUserStats]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            Jackpots
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Compete for daily, stage, and tournament jackpots
          </p>
        </div>

        {/* User Jackpot Stats */}
        {user && (
          <div className="mb-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg shadow-lg p-6 text-white">
            <h2 className="text-2xl font-bold mb-4">Your Jackpot Stats</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-sm opacity-90">Available Balance</div>
                <div className="text-2xl font-bold">{(userStats?.jackpotBalance || 0).toFixed(4)} ETH</div>
              </div>
              <div>
                <div className="text-sm opacity-90">Total Withdrawn</div>
                <div className="text-2xl font-bold">{(userStats?.jackpotWithdrawn || 0).toFixed(4)} ETH</div>
              </div>
              <div>
                <div className="text-sm opacity-90">Total Earned</div>
                <div className="text-2xl font-bold">{(userStats?.totalEarned || 0).toFixed(4)} ETH</div>
              </div>
              <div>
                <div className="text-sm opacity-90">Jackpot Wins</div>
                <div className="text-2xl font-bold">{userStats?.jackpotWins || 0}</div>
              </div>
            </div>
            
            {/* Withdrawal Section */}
            {(userStats?.jackpotBalance || 0) > 0 && (
              <div className="mt-4 pt-4 border-t border-white/20">
                <h3 className="text-lg font-semibold mb-3">Withdraw Jackpot</h3>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="Amount to withdraw"
                    max={userStats?.jackpotBalance || 0}
                    step="0.0001"
                    className="flex-1 px-4 py-2 rounded-lg text-gray-900"
                  />
                  <button
                    onClick={() => setWithdrawAmount((userStats?.jackpotBalance || 0).toString())}
                    className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
                  >
                    Max
                  </button>
                  <button
                    onClick={handleWithdraw}
                    disabled={withdrawing || !withdrawAmount}
                    className="px-6 py-2 bg-white text-purple-600 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {withdrawing ? 'Withdrawing...' : 'Withdraw'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 flex space-x-4">
          {['all', 'free', 'boost'].map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setPagination((p) => ({ ...p, currentPage: 1 })); // Reset to page 1 when filter changes
              }}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                filter === f
                  ? 'bg-blue-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Per-Match/Poll Jackpot Cards - 4 cards per row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {jackpots.map((jackpot) => (
            <div
              key={jackpot._id}
              className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border-2 ${
                jackpot.status === 'resolved'
                  ? 'border-gray-400 dark:border-gray-600'
                  : jackpot.type === 'free' 
                  ? 'border-green-500' 
                  : 'border-purple-500'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  jackpot.type === 'free'
                    ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                    : 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                }`}>
                  {jackpot.type.toUpperCase()}
                </span>
                <span className={`px-2 py-1 rounded text-xs font-semibold ${
                  jackpot.status === 'resolved'
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                    : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                }`}>
                  {jackpot.status === 'resolved' ? 'Resolved' : 'Pending'}
                </span>
              </div>

              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 line-clamp-2">
                {jackpot.title}
              </h3>
              
              {jackpot.cup && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  {jackpot.cup.name}
                </p>
              )}

              <div className="mb-4">
                <div className="text-2xl font-bold text-gray-900 dark:text-white mb-1">
                  {jackpot.amount.toFixed(4)} ETH
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400">
                  Pool Amount
                </div>
              </div>

              <div className="space-y-2 mb-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">Participants:</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{jackpot.participants || 0}</span>
                </div>
                {jackpot.status === 'resolved' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Winners:</span>
                      <span className="font-semibold text-green-600 dark:text-green-400">{jackpot.winners || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Losers:</span>
                      <span className="font-semibold text-red-600 dark:text-red-400">{jackpot.losers || 0}</span>
                    </div>
                    {jackpot.result && (
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Result:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{jackpot.result}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                {jackpot.status === 'resolved' && jackpot.resolvedAt
                  ? `Resolved: ${new Date(jackpot.resolvedAt).toLocaleDateString()}`
                  : `Date: ${new Date(jackpot.date).toLocaleDateString()}`
                }
              </div>

              <button 
                onClick={() => {
                  // Navigate to match/poll detail page with type (boost/free)
                  const path = jackpot.itemType === 'match' 
                    ? `/match/${jackpot.itemId}/${jackpot.type}`
                    : `/poll/${jackpot.itemId}/${jackpot.type}`;
                  window.location.href = path;
                }}
                className="w-full mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
              >
                View Details
              </button>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => setPagination((p) => ({ ...p, currentPage: p.currentPage - 1 }))}
              disabled={!pagination.hasPrev}
              className={`px-4 py-2 rounded-lg font-medium ${
                pagination.hasPrev
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              Previous
            </button>
            <span className="text-gray-600 dark:text-gray-400">
              Page {pagination.currentPage} of {pagination.totalPages} ({pagination.totalItems} total)
            </span>
            <button
              onClick={() => setPagination((p) => ({ ...p, currentPage: p.currentPage + 1 }))}
              disabled={!pagination.hasNext}
              className={`px-4 py-2 rounded-lg font-medium ${
                pagination.hasNext
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              Next
            </button>
          </div>
        )}

        {jackpots.length === 0 && !loading && (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">No jackpot participations available at the moment.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Jackpot;
