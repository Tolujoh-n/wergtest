import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useWallet } from '../context/WalletContext';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { getWalletBalance } from '../utils/blockchain';
import { useNotification } from '../components/Notification';

const Profile = () => {
  const { user, checkAuth } = useAuth();
  const { account, connect } = useWallet();
  const { showNotification } = useNotification();
  const navigate = useNavigate();
  const [profileData, setProfileData] = useState(null);
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [walletBalance, setWalletBalance] = useState('0');
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

  useEffect(() => {
    if (user) {
      fetchProfileData();
    }
  }, [user]);

  useEffect(() => {
    const fetchWalletBalance = async () => {
      if (account) {
        try {
          const balance = await getWalletBalance(account);
          setWalletBalance(balance);
        } catch (error) {
          console.error('Error fetching wallet balance:', error);
        }
      } else {
        setWalletBalance('0');
      }
    };
    fetchWalletBalance();
  }, [account]);

  // Reset to page 1 when filters change (must be before early returns)
  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, filterStatus]);

  const fetchProfileData = async () => {
    try {
      const [profileRes, predictionsRes] = await Promise.all([
        api.get('/users/profile'),
        api.get('/predictions/user'),
      ]);
      setProfileData(profileRes.data);
      setPredictions(predictionsRes.data || []);
    } catch (error) {
      console.error('Error fetching profile data:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const getOutcome = (prediction) => {
    if (prediction.match) {
      const match = prediction.match;
      if (match.isResolved && match.result) {
        return match.result;
      }
      return 'Not Resolved';
    } else if (prediction.poll) {
      const poll = prediction.poll;
      if (poll.isResolved && poll.result) {
        return poll.result;
      }
      return 'Not Resolved';
    }
    return 'N/A';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Profile Header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 mb-6">
          <div className="flex items-center space-x-6">
            <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-4xl font-bold">
              {user.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1">
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
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {stats.points} Points
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Points</div>
              {account ? (
                <div className="mt-2">
                  <div className="text-lg font-semibold text-green-600 dark:text-green-400">
                    {parseFloat(walletBalance).toFixed(4)} ETH
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-500">Wallet Balance</div>
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
                  {boostPredictions.reduce((sum, p) => sum + (p.amount || 0), 0).toFixed(3)} ETH
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Total Payout</span>
                <span className="font-semibold text-green-600 dark:text-green-400">
                  {boostPredictions.reduce((sum, p) => sum + (p.payout || 0), 0).toFixed(3)} ETH
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

        {/* Recent Predictions */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
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
                        {prediction.outcome}
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
