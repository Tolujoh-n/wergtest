import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { FireIcon } from '../components/UiIcons';

function StreakCard({ title, description, icon, current, best, barClass }) {
  const pct = best > 0 ? Math.min(100, Math.round((current / best) * 100)) : current > 0 ? 100 : 0;
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 leading-relaxed">{description}</p>
        </div>
        <span className="text-2xl shrink-0" aria-hidden>
          {icon}
        </span>
      </div>
      <div className="flex items-end justify-between gap-4 mb-3">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Current streak</p>
          <p className="text-4xl font-bold tabular-nums text-gray-900 dark:text-white">{current}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Best streak</p>
          <p className="text-xl font-semibold tabular-nums text-gray-700 dark:text-gray-300">{best}</p>
        </div>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
        {best > 0 ? `${pct}% of your personal best` : 'Start building your streak today'}
      </p>
    </div>
  );
}

const Streaks = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchGenRef = useRef(0);

  const fetchUserStreak = useCallback(async ({ silent = false } = {}) => {
    if (!user?._id) {
      setStats(null);
      setLoading(false);
      return;
    }
    const gen = ++fetchGenRef.current;
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/streaks/user');
      if (gen !== fetchGenRef.current) return;
      setStats(data);
    } catch (error) {
      if (gen !== fetchGenRef.current) return;
      console.error('Error fetching streaks:', error);
      setStats(null);
    } finally {
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }, [user?._id]);

  useEffect(() => {
    fetchUserStreak();
  }, [fetchUserStreak]);

  useEffect(() => {
    if (!user?._id) return undefined;
    const id = setInterval(() => fetchUserStreak({ silent: true }), 60000);
    return () => clearInterval(id);
  }, [user?._id, fetchUserStreak]);

  if (loading && !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500" />
      </div>
    );
  }

  const total = stats?.totalStreak ?? stats?.currentStreak ?? 0;
  const totalBest = stats?.bestStreak ?? stats?.longestStreak ?? 0;
  const login = stats?.login || { current: 0, best: 0 };
  const free = stats?.free || { current: 0, best: 0 };
  const boost = stats?.boost || { current: 0, best: 0 };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Your streaks</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Track daily login, free predictions, and boost activity. Your total streak is the sum of all three.
          </p>
        </div>

        {!user ? (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center">
            <p className="text-gray-600 dark:text-gray-400 mb-4">Log in to see your personal streak stats.</p>
            <Link
              to="/login"
              className="inline-flex px-6 py-2.5 bg-orange-500 text-white rounded-lg font-semibold hover:bg-orange-600"
            >
              Log in
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl shadow-lg p-6 sm:p-8 text-white">
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div>
                  <p className="text-sm font-medium opacity-90 uppercase tracking-wide">Total streak</p>
                  <p className="text-5xl font-bold tabular-nums mt-1 inline-flex items-center gap-3">
                    <FireIcon className="w-10 h-10 text-white/90 shrink-0" />
                    {total}
                  </p>
                  <p className="text-sm opacity-90 mt-2 tabular-nums">
                    Login {login.current} + Free {free.current} + Boost {boost.current}
                  </p>
                  <p className="text-sm opacity-80 mt-1 tabular-nums">Combined best: {totalBest}</p>
                </div>
                <div className="text-sm opacity-90 max-w-xs leading-relaxed">
                  Each streak resets if you skip a full day without that activity. Keep all three going to climb the
                  leaderboard.
                </div>
              </div>
              {totalBest > 0 && (
                <div className="mt-6 h-2 rounded-full bg-white/20 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-white/90 transition-all"
                    style={{ width: `${Math.min(100, Math.round((total / totalBest) * 100))}%` }}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
              <StreakCard
                title="Login streak"
                description="Log in at least once per day. Resets if you miss a full day."
                icon="🔑"
                current={login.current}
                best={login.best}
                barClass="bg-blue-500"
              />
              <StreakCard
                title="Free prediction streak"
                description="Make a free prediction on a match or poll each day. +1 per new game."
                icon="🎟️"
                current={free.current}
                best={free.best}
                barClass="bg-emerald-500"
              />
              <StreakCard
                title="Boost streak"
                description="Place a boost stake on a match or poll each day. +1 per new game."
                icon="⚡"
                current={boost.current}
                best={boost.best}
                barClass="bg-purple-500"
              />
            </div>

            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              See how you rank against others on the{' '}
              <Link to="/leaderboard" className="text-orange-600 dark:text-orange-400 font-medium hover:underline">
                leaderboard
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default Streaks;
