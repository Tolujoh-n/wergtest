import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

const Streaks = () => {
  const [searchParams] = useSearchParams();
  const cupSlug = searchParams.get('cup');
  const { user } = useAuth();
  const [topStreaks, setTopStreaks] = useState([]);
  const [userStreak, setUserStreak] = useState(null);
  const [streakHistory, setStreakHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStreaks();
    if (user) {
      fetchUserStreak();
    }
  }, [cupSlug, user]);

  const fetchStreaks = async () => {
    setLoading(true);
    try {
      const endpoint = cupSlug 
        ? `/api/streaks/cup/${cupSlug}`
        : '/api/streaks';
      const response = await api.get(endpoint);
      setTopStreaks(response.data || []);
    } catch (error) {
      console.error('Error fetching streaks:', error);
      setTopStreaks([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserStreak = async () => {
    try {
      const response = await api.get('/api/streaks/user');
      setUserStreak(response.data);
      setStreakHistory(response.data.history || []);
    } catch (error) {
      console.error('Error fetching user streak:', error);
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
            Streaks
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            {cupSlug ? `Top streaks for ${cupSlug}` : 'Top streaks across all tournaments'}
          </p>
        </div>

        {/* User's Current Streak */}
        {user && userStreak && (
          <div className="mb-8 bg-gradient-to-r from-orange-500 to-red-500 rounded-lg shadow-lg p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-2">Your Current Streak</h2>
                <p className="text-3xl font-bold">🔥 {userStreak.currentStreak || 0}</p>
                <p className="text-sm opacity-90 mt-2">
                  Best Streak: {userStreak.bestStreak || 0}
                </p>
              </div>
              <div className="text-6xl">🔥</div>
            </div>
          </div>
        )}

        {/* Top Streaks */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Top Streaks
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {topStreaks.slice(0, 10).map((streakUser, index) => (
              <div
                key={streakUser._id}
                className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 ${
                  index < 3 ? 'border-2 border-orange-500' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                      {streakUser.username?.[0]?.toUpperCase() || 'U'}
                    </div>
                    <div className="ml-4">
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {streakUser.username}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        Rank #{index + 1}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-orange-500 mb-2">
                    🔥 {streakUser.streak || 0}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {streakUser.correctPredictions || 0} correct predictions
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Streak History */}
        {user && streakHistory.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Your Streak History
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                      Streak Length
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {streakHistory.map((entry, index) => (
                    <tr key={index}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {new Date(entry.date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">
                        🔥 {entry.length}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          entry.status === 'active' 
                            ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                        }`}>
                          {entry.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {topStreaks.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">No streak data available yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Streaks;
