import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';

const Home = () => {
  const [cups, setCups] = useState([]);
  const [trendingMatches, setTrendingMatches] = useState([]);
  const [featuredMatches, setFeaturedMatches] = useState([]);
  const [topJackpot, setTopJackpot] = useState(null);
  const [topStreaks, setTopStreaks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    try {
      const [cupsRes, matchesRes, jackpotsRes, streaksRes] = await Promise.all([
        api.get('/cups'),
        api.get('/matches'),
        api.get('/jackpots'),
        api.get('/streaks'),
      ]);

      setCups(cupsRes.data);
      
      const matches = matchesRes.data || [];
      setTrendingMatches(matches.filter(m => m.status === 'live' || m.status === 'upcoming').slice(0, 6));
      setFeaturedMatches(matches.filter(m => m.isFeatured).slice(0, 6));
      
      const jackpots = jackpotsRes.data || [];
      setTopJackpot(jackpots.sort((a, b) => b.amount - a.amount)[0]);
      
      setTopStreaks(streaksRes.data?.slice(0, 5) || []);
    } catch (error) {
      console.error('Error fetching data:', error);
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-5xl font-bold mb-4">Welcome to WeRgame</h1>
          <p className="text-xl mb-8">
            Predict match outcomes, buy shares, build streaks, and compete for jackpots
          </p>
          <div className="flex space-x-4">
            <Link
              to="/leaderboard"
              className="px-6 py-3 bg-white text-blue-600 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
            >
              View Leaderboard
            </Link>
            <Link
              to="/jackpot"
              className="px-6 py-3 bg-transparent border-2 border-white text-white rounded-lg font-semibold hover:bg-white hover:text-blue-600 transition-colors"
            >
              View Jackpots
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Top Jackpot Section */}
        {topJackpot && (
          <div className="mb-12">
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 rounded-lg shadow-xl p-8 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold mb-2">Top Jackpot</h2>
                  <p className="text-xl mb-4">{topJackpot.name}</p>
                  <div className="text-4xl font-bold mb-2">
                    {topJackpot.amount} {topJackpot.type === 'free' ? 'Points' : 'ETH'}
                  </div>
                  <p className="text-sm opacity-90">{topJackpot.participants || 0} participants</p>
                </div>
                <div className="text-6xl">💰</div>
              </div>
              <Link
                to="/jackpot"
                className="inline-block mt-4 px-6 py-3 bg-white text-orange-600 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
              >
                View All Jackpots
              </Link>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
          {/* Featured Games */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Featured Games</h2>
              <Link
                to="/"
                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
              >
                View All
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {featuredMatches.length > 0 ? (
                featuredMatches.map((match) => (
                  <MatchCard key={match._id} match={match} />
                ))
              ) : (
                <div className="col-span-2 text-center py-8 text-gray-600 dark:text-gray-400">
                  No featured games at the moment
                </div>
              )}
            </div>
          </div>

          {/* Top Streaks */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Top Streaks</h2>
              <Link
                to="/streaks"
                className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
              >
                View All
              </Link>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
              {topStreaks.length > 0 ? (
                <div className="space-y-4">
                  {topStreaks.map((user, index) => (
                    <div
                      key={user._id}
                      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900 dark:text-white">
                            {user.username}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {user.correctPredictions || 0} correct
                          </div>
                        </div>
                      </div>
                      <div className="text-2xl font-bold text-orange-500">
                        🔥 {user.streak || 0}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-600 dark:text-gray-400">
                  No streak data yet
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Trending Games */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Trending Games</h2>
            <Link
              to="/"
              className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View All
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {trendingMatches.length > 0 ? (
              trendingMatches.map((match) => (
                <MatchCard key={match._id} match={match} />
              ))
            ) : (
              <div className="col-span-3 text-center py-8 text-gray-600 dark:text-gray-400">
                No trending games at the moment
              </div>
            )}
          </div>
        </div>

        {/* All Tournaments */}
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">All Tournaments</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cups.map((cup) => (
              <Link
                key={cup._id}
                to={`/cup/${cup.slug}`}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                    {cup.name}
                  </h3>
                  <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm">
                    {cup.status}
                  </span>
                </div>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  {cup.description}
                </p>
                <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                  <span>{cup.activeMatches || 0} Active Matches</span>
                  <span>{cup.activePolls || 0} Active Polls</span>
                </div>
              </Link>
            ))}
          </div>

          {cups.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-600 dark:text-gray-400">
                No tournaments available at the moment. Check back soon!
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const MatchCard = ({ match }) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            {match.teamA} vs {match.teamB}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {new Date(match.date).toLocaleDateString()} • {match.stageName || 'Unknown'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {match.isResolved && (
            <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
              RESOLVED
            </span>
          )}
          <span className={`px-2 py-1 rounded-full text-xs ${
            match.status === 'upcoming' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
            match.status === 'live' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
            'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
          }`}>
            {match.status}
          </span>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <Link
          to={`/match/${match._id}/free`}
          className="flex-1 px-3 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-center text-sm"
        >
          FREE
        </Link>
        <Link
          to={`/match/${match._id}/boost`}
          className="flex-1 px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-center text-sm"
        >
          BOOST
        </Link>
        <Link
          to={`/match/${match._id}/market`}
          className="flex-1 px-3 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-center text-sm"
        >
          MARKET
        </Link>
      </div>
    </div>
  );
};

export default Home;
