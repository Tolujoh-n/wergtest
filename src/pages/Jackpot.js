import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const Jackpot = () => {
  const [searchParams] = useSearchParams();
  const cupSlug = searchParams.get('cup');
  const { user } = useAuth();
  const [jackpots, setJackpots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, free, boost

  useEffect(() => {
    fetchJackpots();
  }, [cupSlug, filter]);

  const fetchJackpots = async () => {
    setLoading(true);
    try {
      const endpoint = cupSlug 
        ? `/api/jackpots/cup/${cupSlug}?type=${filter}`
        : `/api/jackpots?type=${filter}`;
      const response = await api.get(endpoint);
      setJackpots(response.data || []);
    } catch (error) {
      console.error('Error fetching jackpots:', error);
      setJackpots([]);
    } finally {
      setLoading(false);
    }
  };

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

        {/* Filters */}
        <div className="mb-6 flex space-x-4">
          {['all', 'free', 'boost'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
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

        {/* Jackpot Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {jackpots.map((jackpot) => (
            <div
              key={jackpot._id}
              className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border-2 ${
                jackpot.type === 'free' 
                  ? 'border-green-500' 
                  : 'border-purple-500'
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  {jackpot.name}
                </h3>
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                  jackpot.type === 'free'
                    ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                    : 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                }`}>
                  {jackpot.type.toUpperCase()}
                </span>
              </div>

              <div className="mb-4">
                <div className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  {jackpot.amount} {jackpot.type === 'free' ? 'Points' : 'ETH'}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {jackpot.participants || 0} participants
                </div>
              </div>

              <div className="mb-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                  Eligibility Requirements:
                </div>
                <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                  <li>• {jackpot.minStreak || 3}+ correct picks</li>
                  <li>• {jackpot.minPredictions || 5}+ predictions</li>
                  {jackpot.type === 'free' && (
                    <li>• Active streak of {jackpot.minStreak || 3}+</li>
                  )}
                </ul>
              </div>

              <div className="mb-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                  Ends: {new Date(jackpot.endDate).toLocaleDateString()}
                </div>
              </div>

              {user && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Your Eligibility: {jackpot.userEligible ? '✅ Eligible' : '❌ Not Eligible'}
                  </div>
                  {jackpot.userEligible && (
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Your chances: {jackpot.userChance || 0}%
                    </div>
                  )}
                </div>
              )}

              <button className="w-full mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
                View Details
              </button>
            </div>
          ))}
        </div>

        {jackpots.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">No jackpots available at the moment.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Jackpot;
