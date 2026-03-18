import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../utils/api';
import Modal from '../components/Modal';

const CupPage = () => {
  const { cupSlug } = useParams();
  const [cup, setCup] = useState(null);
  const [stages, setStages] = useState([]);
  const [selectedStage, setSelectedStage] = useState(null);
  const [featuredMatches, setFeaturedMatches] = useState([]);
  const [featuredPolls, setFeaturedPolls] = useState([]);
  const [sponsoredMatches, setSponsoredMatches] = useState([]);
  const [sponsoredPolls, setSponsoredPolls] = useState([]);
  const [matches, setMatches] = useState([]);
  const [awardPolls, setAwardPolls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTeamsModal, setShowTeamsModal] = useState(false);

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

      // Filter featured matches and polls
      const featuredMatchesData = matchesRes.data.filter(m => m.isFeatured);
      setFeaturedMatches(featuredMatchesData);
      
      // Filter sponsored matches
      const sponsoredMatchesData = matchesRes.data.filter(m => m.isSponsored);
      setSponsoredMatches(sponsoredMatchesData);
      
      // Fetch all polls to get featured and sponsored ones
      try {
        const allPollsRes = await api.get(`/polls/cup/${cupSlug}`);
        const featuredPollsData = allPollsRes.data.filter(p => p.isFeatured);
        setFeaturedPolls(featuredPollsData);
        const sponsoredPollsData = allPollsRes.data.filter(p => p.isSponsored);
        setSponsoredPolls(sponsoredPollsData);
      } catch (error) {
        console.error('Error fetching polls:', error);
        setFeaturedPolls([]);
        setSponsoredPolls([]);
      }

      if (sortedStages.length > 0) {
        // Find the current active stage (isCurrent or currentActive)
        const currentStage = sortedStages.find(s => s.isCurrent || s.currentActive);
        setSelectedStage((currentStage && currentStage._id) || sortedStages[0]._id);
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
            {/* Team Images Section - Before Featured Section */}
            {selectedStage && (() => {
              const teams = new Map();
              filteredMatches.forEach(match => {
                if (match.teamA && match.teamAImage) {
                  teams.set(match.teamA, match.teamAImage);
                }
                if (match.teamB && match.teamBImage) {
                  teams.set(match.teamB, match.teamBImage);
                }
              });
              const teamArray = Array.from(teams.entries()).map(([name, image]) => ({ name, image }));
              const displayCount = 8;
              const showMore = teamArray.length > displayCount;
              
              if (teamArray.length > 0) {
                return (
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        Teams in {stages.find(s => s._id === selectedStage)?.name || 'Current Stage'}
                      </h2>
                      {showMore && (
                        <button
                          onClick={() => setShowTeamsModal(true)}
                          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm font-medium"
                        >
                          View All ({teamArray.length} teams)
                        </button>
                      )}
                      {!showMore && teamArray.length > 0 && (
                        <button
                          onClick={() => setShowTeamsModal(true)}
                          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
                        >
                          View All
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                      {teamArray.slice(0, displayCount).map((team, idx) => (
                        <div key={idx} className="flex flex-col items-center group cursor-pointer" onClick={() => setShowTeamsModal(true)}>
                          <img
                            src={team.image}
                            alt={team.name}
                            className="w-12 h-12 object-cover rounded-full border-2 border-gray-200 dark:border-gray-700 mb-1 group-hover:border-blue-500 dark:group-hover:border-blue-400 transition-colors"
                          />
                          <p className="text-xs text-center text-gray-700 dark:text-gray-300 font-medium truncate w-full">
                            {team.name}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Featured Section */}
            {(featuredMatches.length > 0 || featuredPolls.length > 0) && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                  Featured
                </h2>
                <div className="space-y-4">
                  {/* Featured Matches */}
                  {featuredMatches.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">
                        Featured Matches
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {featuredMatches.map((match) => (
                          <MatchCard key={match._id} match={match} featured sponsored={match.isSponsored} />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Featured Polls */}
                  {featuredPolls.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">
                        Featured Polls
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {featuredPolls.map((poll) => (
                          <PollCard key={poll._id} poll={poll} featured sponsored={poll.isSponsored} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sponsored Section */}
            {(sponsoredMatches.length > 0 || sponsoredPolls.length > 0) && (
              <div className="bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/30 dark:to-gray-800 rounded-lg shadow-lg p-6 border-2 border-amber-200 dark:border-amber-700">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-2xl">⭐</span>
                  <h2 className="text-xl font-bold text-amber-900 dark:text-amber-200">
                    Sponsored
                  </h2>
                </div>
                <div className="space-y-4">
                  {/* Sponsored Matches */}
                  {sponsoredMatches.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-300 mb-3">
                        Sponsored Matches
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {sponsoredMatches.map((match) => (
                          <MatchCard key={match._id} match={match} sponsored />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Sponsored Polls */}
                  {sponsoredPolls.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold text-amber-800 dark:text-amber-300 mb-3">
                        Sponsored Polls
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {sponsoredPolls.map((poll) => (
                          <PollCard key={poll._id} poll={poll} sponsored />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
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

      {/* Teams Modal */}
      {showTeamsModal && selectedStage && (() => {
        const teams = new Map();
        filteredMatches.forEach(match => {
          if (match.teamA && match.teamAImage) {
            teams.set(match.teamA, match.teamAImage);
          }
          if (match.teamB && match.teamBImage) {
            teams.set(match.teamB, match.teamBImage);
          }
        });
        const teamArray = Array.from(teams.entries()).map(([name, image]) => ({ name, image }));
        
        if (teamArray.length === 0) {
          return null;
        }
        
        return (
          <Modal isOpen={true} onClose={() => setShowTeamsModal(false)} title={`All Teams - ${stages.find(s => s._id === selectedStage)?.name || 'Current Stage'}`} size="lg">
            <div className="max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4 p-2">
                {teamArray.map((team, idx) => (
                  <div key={idx} className="flex flex-col items-center">
                    <img
                      src={team.image}
                      alt={team.name}
                      className="w-16 h-16 object-cover rounded-full border-2 border-gray-200 dark:border-gray-700 mb-2 shadow-md hover:shadow-lg transition-shadow"
                    />
                    <p className="text-xs text-center text-gray-700 dark:text-gray-300 font-medium">
                      {team.name}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
};

const MatchCard = ({ match, featured = false, sponsored = false }) => {
  const formatGMTTime = (date) => {
    return new Date(date).toLocaleString('en-GB', {
      timeZone: 'GMT',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' GMT';
  };

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 ${featured ? 'border-2 border-blue-500' : ''} ${sponsored ? 'border-2 border-amber-400 bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/20 dark:to-gray-800' : ''}`}>
      {/* Sponsored Images Banner */}
      {sponsored && match.sponsoredImages && match.sponsoredImages.length > 0 && (
        <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">SPONSORED</span>
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {match.sponsoredImages.map((img, idx) => (
              <img
                key={idx}
                src={img}
                alt={`Sponsor ${idx + 1}`}
                className="h-16 object-contain rounded-lg border border-gray-200 dark:border-gray-700"
              />
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        {/* Teams aligned horizontally */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-2 flex-1">
            {match.teamAImage && (
              <img src={match.teamAImage} alt={match.teamA} className="w-10 h-10 object-cover rounded-full" />
            )}
            <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">
              {match.teamA}
            </h3>
          </div>
          <span className="text-gray-400 dark:text-gray-500 font-semibold">VS</span>
          <div className="flex items-center gap-2 flex-1">
            {match.teamBImage && (
              <img src={match.teamBImage} alt={match.teamB} className="w-10 h-10 object-cover rounded-full" />
            )}
            <h3 className="text-lg font-bold text-gray-900 dark:text-white truncate">
              {match.teamB}
            </h3>
          </div>
        </div>

        {/* Status and Timeline row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {match.isResolved && (
              <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
                RESOLVED
              </span>
            )}
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              match.status === 'upcoming' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
              match.status === 'live' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
              match.status === 'locked' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
              'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
            }`}>
              {match.status?.toUpperCase()}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              {match.stageName}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {formatGMTTime(match.date)}
            </p>
          </div>
        </div>
      </div>

      {/* Jackpot Pools Display */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
          <div className="text-xs text-green-600 dark:text-green-400 font-semibold mb-1">Free Jackpot</div>
          <div className="text-sm font-bold text-green-700 dark:text-green-300">
            {((match.isResolved && match.originalFreeJackpotPool) ? match.originalFreeJackpotPool : (match.freeJackpotPool || 0)).toFixed(4)} ETH
          </div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
          <div className="text-xs text-blue-600 dark:text-blue-400 font-semibold mb-1">Boost Jackpot</div>
          <div className="text-sm font-bold text-blue-700 dark:text-blue-300">
            {((match.isResolved && match.originalBoostJackpotPool) ? match.originalBoostJackpotPool : (match.boostJackpotPool || 0)).toFixed(4)} ETH
          </div>
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

const PollCard = ({ poll, sponsored = false, featured = false }) => {
  const formatGMTTime = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString('en-GB', {
      timeZone: 'GMT',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' GMT';
  };

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 ${
      featured ? 'border-2 border-blue-500' : ''
    } ${
      sponsored ? 'border-2 border-amber-400 bg-gradient-to-br from-amber-50 to-white dark:from-amber-900/20 dark:to-gray-800' : ''
    }`}>
      {/* Sponsored Images Banner */}
      {sponsored && poll.sponsoredImages && poll.sponsoredImages.length > 0 && (
        <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">SPONSORED</span>
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {poll.sponsoredImages.map((img, idx) => (
              <img
                key={idx}
                src={img}
                alt={`Sponsor ${idx + 1}`}
                className="h-16 object-contain rounded-lg border border-gray-200 dark:border-gray-700"
              />
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
          {poll.question}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          {poll.description}
        </p>

        {/* Status and Timeline row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {poll.isResolved && (
              <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
                RESOLVED
              </span>
            )}
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              poll.status === 'upcoming' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
              poll.status === 'active' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
              poll.status === 'locked' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
              'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
            }`}>
              {poll.status?.toUpperCase()}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              {poll.type?.toUpperCase() || 'POLL'}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {formatGMTTime(poll.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Show poll options with images if option-based */}
      {poll.optionType === 'options' && poll.options && poll.options.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {poll.options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
              {opt.image && (
                <img src={opt.image} alt={opt.text} className="w-8 h-8 object-cover rounded-full" />
              )}
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{opt.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Jackpot Pools Display */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
          <div className="text-xs text-green-600 dark:text-green-400 font-semibold mb-1">Free Jackpot</div>
          <div className="text-sm font-bold text-green-700 dark:text-green-300">
            {((poll.isResolved && poll.originalFreeJackpotPool) ? poll.originalFreeJackpotPool : (poll.freeJackpotPool || 0)).toFixed(4)} ETH
          </div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
          <div className="text-xs text-blue-600 dark:text-blue-400 font-semibold mb-1">Boost Jackpot</div>
          <div className="text-sm font-bold text-blue-700 dark:text-blue-300">
            {((poll.isResolved && poll.originalBoostJackpotPool) ? poll.originalBoostJackpotPool : (poll.boostJackpotPool || 0)).toFixed(4)} ETH
          </div>
        </div>
      </div>

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
