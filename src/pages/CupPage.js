import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../utils/api';

const CupPage = () => {
  const { cupSlug } = useParams();
  const [cup, setCup] = useState(null);
  const [stages, setStages] = useState([]);
  const [selectedStage, setSelectedStage] = useState(null);
  const [featuredMatch, setFeaturedMatch] = useState(null);
  const [matches, setMatches] = useState([]);
  const [awardPolls, setAwardPolls] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchCupData = useCallback(async () => {
    try {
      const [cupRes, stagesRes, matchesRes, pollsRes] = await Promise.all([
        api.get(`/cups/slug/${cupSlug}`),
        api.get(`/cups/${cupSlug}/stages`),
        api.get(`/matches/cup/${cupSlug}`),
        api.get(`/polls/cup/${cupSlug}?type=award`),
      ]);

      setCup(cupRes.data);
      // Sort stages by order
      const sortedStages = [...stagesRes.data].sort((a, b) => (a.order || 0) - (b.order || 0));
      setStages(sortedStages);
      setMatches(matchesRes.data);
      setAwardPolls(pollsRes.data);

      if (sortedStages.length > 0) {
        // Find the current active stage (isCurrent or currentActive)
        const currentStage = sortedStages.find(s => s.isCurrent || s.currentActive);
        setSelectedStage((currentStage && currentStage._id) || sortedStages[0]._id);
      }

      if (matchesRes.data.length > 0) {
        setFeaturedMatch(matchesRes.data[0]);
      }
    } catch (error) {
      console.error('Error fetching cup data:', error);
    } finally {
      setLoading(false);
    }
  }, [cupSlug]);

  useEffect(() => {
    fetchCupData();
  }, [cupSlug, fetchCupData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!cup) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">Cup not found</p>
      </div>
    );
  }

  const filteredMatches = matches.filter((match) => {
    if (!selectedStage) return true;
    // Handle both object and ID cases
    const matchStageId = typeof match.stage === 'object' ? match.stage?._id : match.stage;
    return matchStageId === selectedStage;
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
                {cup.name}
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400">
                {cup.description}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Link
                to={`/leaderboard?cup=${cupSlug}`}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
                <span>Leaderboard</span>
              </Link>
              <Link
                to={`/streaks?cup=${cupSlug}`}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors flex items-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Streaks</span>
              </Link>
              <Link
                to={`/jackpot?cup=${cupSlug}`}
                className="px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors flex items-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Jackpot</span>
              </Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Sidebar - Stages */}
          <aside className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sticky top-24">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                Tournament Timeline
              </h2>
              <div className="relative">
                {/* Vertical progress line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />
                <ul className="space-y-4 relative">
                  {stages.map((stage, index) => {
                    const isSelected = selectedStage === stage._id;
                    const isCurrent = stage.isCurrent || stage.currentActive;
                    return (
                      <li key={stage._id} className="flex items-start space-x-3">
                        {/* Timeline dot */}
                        <div className="relative mt-1">
                          <div
                            className={`w-3 h-3 rounded-full border-2 ${
                              isCurrent
                                ? 'bg-blue-500 border-blue-500 animate-pulse'
                                : isSelected
                                  ? 'bg-blue-500 border-blue-500'
                                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600'
                            }`}
                          />
                        </div>
                        <button
                          onClick={() => setSelectedStage(stage._id)}
                          className={`flex-1 text-left px-3 py-2 rounded-lg transition-colors ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-900 text-blue-700 dark:text-blue-200'
                              : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">{stage.name}</span>
                            {isCurrent && (
                              <span className="ml-2 px-2 py-0.5 text-[10px] rounded-full bg-blue-500 text-white uppercase tracking-wide">
                                Active
                              </span>
                            )}
                          </div>
                          {(stage.startDate || stage.endDate) && (
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {stage.startDate &&
                                new Date(stage.startDate).toLocaleDateString()}{' '}
                              {stage.endDate &&
                                `- ${new Date(stage.endDate).toLocaleDateString()}`}
                            </p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-6">
            {/* Featured Match */}
            {featuredMatch && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                  Featured Poll
                </h2>
                <MatchCard match={featuredMatch} featured />
              </div>
            )}

            {/* Match Polls */}
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                Match Polls {selectedStage && `(${stages.find(s => s._id === selectedStage)?.name || 'Current Stage'})`}
              </h2>
              {filteredMatches.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredMatches.map((match) => (
                    <MatchCard key={match._id} match={match} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-600 dark:text-gray-400">
                  No matches found for the selected stage.
                </div>
              )}
            </div>

            {/* Award Polls */}
            {awardPolls.length > 0 && (
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Award Polls
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {awardPolls.map((poll) => (
                    <PollCard key={poll._id} poll={poll} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const MatchCard = ({ match, featured = false }) => {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 ${featured ? 'border-2 border-blue-500' : ''}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">
            {match.teamA} vs {match.teamB}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {new Date(match.date).toLocaleDateString()} • {match.stageName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {match.isResolved && (
            <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
              RESOLVED
            </span>
          )}
          <span className={`px-3 py-1 rounded-full text-sm ${
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
          className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-center"
        >
          FREE
        </Link>
        <Link
          to={`/match/${match._id}/boost`}
          className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-center"
        >
          BOOST
        </Link>
        <Link
          to={`/match/${match._id}/market`}
          className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-center"
        >
          MARKET
        </Link>
      </div>
    </div>
  );
};

const PollCard = ({ poll }) => {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
          {poll.question}
        </h3>
        {poll.isResolved && (
          <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
            RESOLVED
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {poll.description}
      </p>
      <div className="flex items-center space-x-2">
        <Link
          to={`/poll/${poll._id}/free`}
          className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-center"
        >
          FREE
        </Link>
        <Link
          to={`/poll/${poll._id}/boost`}
          className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-center"
        >
          BOOST
        </Link>
        <Link
          to={`/poll/${poll._id}/market`}
          className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-center"
        >
          MARKET
        </Link>
      </div>
    </div>
  );
};

export default CupPage;
