import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { FireIcon } from '../components/UiIcons';

function streakRowKey(row) {
  return String(row?._id || row?.username || '');
}

function streakListSignature(list) {
  return (list || [])
    .map(
      (u) =>
        `${streakRowKey(u)}:${u.currentStreak ?? u.streak ?? 0}:${u.longestStreak ?? 0}:${u.correctPredictions ?? 0}`
    )
    .join('|');
}

const Streaks = () => {
  const [searchParams] = useSearchParams();
  const cupSlug = searchParams.get('cup');
  const { user } = useAuth();
  const userId = user?._id != null ? String(user._id) : '';

  const [topStreaks, setTopStreaks] = useState([]);
  const [userStreak, setUserStreak] = useState(null);
  const [streakHistory, setStreakHistory] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  const streaksEverLoadedRef = useRef(false);
  const streakFetchGenRef = useRef(0);
  const userStreakFetchGenRef = useRef(0);

  const fetchStreaks = useCallback(async ({ silent = false } = {}) => {
    const gen = ++streakFetchGenRef.current;
    const showInitial = !silent && !streaksEverLoadedRef.current;
    if (showInitial) setInitialLoading(true);
    else if (!silent) setRefreshing(true);

    try {
      const endpoint = cupSlug ? `/streaks/cup/${cupSlug}` : '/streaks';
      const { data } = await api.get(endpoint);
      if (gen !== streakFetchGenRef.current) return;

      const list = Array.isArray(data) ? data : [];
      setTopStreaks((prev) => {
        if (streakListSignature(prev) === streakListSignature(list)) return prev;
        return list;
      });
      streaksEverLoadedRef.current = true;
    } catch (error) {
      if (gen !== streakFetchGenRef.current) return;
      console.error('Error fetching streaks:', error);
      if (!streaksEverLoadedRef.current) setTopStreaks([]);
    } finally {
      if (gen !== streakFetchGenRef.current) return;
      if (showInitial) setInitialLoading(false);
      setRefreshing(false);
    }
  }, [cupSlug]);

  const fetchUserStreak = useCallback(async () => {
    if (!userId) {
      setUserStreak(null);
      setStreakHistory([]);
      return;
    }
    const gen = ++userStreakFetchGenRef.current;
    try {
      const { data } = await api.get('/streaks/user');
      if (gen !== userStreakFetchGenRef.current) return;
      setUserStreak(data);
      setStreakHistory(Array.isArray(data?.history) ? data.history : []);
    } catch (error) {
      if (gen !== userStreakFetchGenRef.current) return;
      console.error('Error fetching user streak:', error);
    }
  }, [userId]);

  useEffect(() => {
    streaksEverLoadedRef.current = false;
    setTopStreaks([]);
    setCurrentPage(1);
    fetchStreaks({ silent: false });
  }, [cupSlug, fetchStreaks]);

  useEffect(() => {
    fetchUserStreak();
  }, [userId, fetchUserStreak]);

  useEffect(() => {
    if (!streaksEverLoadedRef.current) return undefined;
    const id = setInterval(() => {
      fetchStreaks({ silent: true });
      if (userId) fetchUserStreak();
    }, 30000);
    return () => clearInterval(id);
  }, [userId, fetchStreaks, fetchUserStreak]);

  if (initialLoading && !streaksEverLoadedRef.current) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  const totalPages = Math.ceil(topStreaks.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedStreaks = topStreaks.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Streaks</h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              {cupSlug ? `Top streaks for ${cupSlug}` : 'Top streaks across all tournaments'}
            </p>
          </div>
          {refreshing ? (
            <span className="text-xs text-gray-500 dark:text-gray-400">Updating…</span>
          ) : null}
        </div>

        {user && userStreak && (
          <div className="mb-8 bg-gradient-to-r from-orange-500 to-red-500 rounded-lg shadow-lg p-6 text-white">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold mb-2">Your streak</h2>
                <p className="text-3xl font-bold tabular-nums inline-flex items-center gap-2">
                  <FireIcon className="w-8 h-8 text-white/90 shrink-0" />
                  {userStreak.currentStreak || 0}
                </p>
                <p className="text-sm opacity-90 mt-2 tabular-nums">
                  {(userStreak.correctPredictions ?? 0).toLocaleString()} correct free predictions
                </p>
                <p className="text-sm opacity-90 mt-1 tabular-nums">
                  Longest streak: {(userStreak.longestStreak ?? userStreak.bestStreak ?? 0).toLocaleString()}
                </p>
              </div>
              <FireIcon className="w-16 h-16 text-white/30 shrink-0 hidden sm:block" />
            </div>
          </div>
        )}

        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Top Streaks</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {paginatedStreaks.map((streakUser, index) => {
              const rank = startIndex + index + 1;
              const streakVal = streakUser.currentStreak ?? streakUser.streak ?? 0;
              return (
                <div
                  key={streakRowKey(streakUser) || rank}
                  className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 ${
                    rank <= 3 ? 'border-2 border-orange-500' : ''
                  }`}
                >
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold shrink-0">
                      {streakUser.username?.[0]?.toUpperCase() || 'U'}
                    </div>
                    <div className="ml-4 min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-white truncate">
                        {streakUser.username}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Rank #{rank}</div>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-4xl font-bold text-orange-500 mb-2 tabular-nums inline-flex items-center justify-center gap-1.5">
                      <FireIcon className="w-7 h-7 shrink-0" />
                      {streakVal}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                      {(streakUser.correctPredictions ?? 0).toLocaleString()} correct predictions
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 tabular-nums">
                      Longest: {(streakUser.longestStreak ?? 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className={`px-4 py-2 rounded-lg font-medium ${
                  currentPage === 1
                    ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
              >
                Previous
              </button>
              <span className="text-gray-600 dark:text-gray-400 tabular-nums">
                Page {currentPage} of {totalPages} ({topStreaks.length} total)
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
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

        {user && streakHistory.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Your Streak History</h2>
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
                    <tr key={`${entry.date}-${entry.length}-${index}`}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {new Date(entry.date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                        {entry.length}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
                            entry.status === 'active'
                              ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                          }`}
                        >
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
