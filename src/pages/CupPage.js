import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../utils/api';
import Modal from '../components/Modal';
import { formatUsdAmount } from '../utils/money';
import JackpotPoolsBanner, { jackpotPoolsFromItem } from '../components/JackpotPoolsBanner';
import { fetchPollImpliedBatch, rankPollOptionsByImplied } from '../utils/pollImplied';
import { normalizeSponsoredImages, normalizeSponsoredImageEntry } from '../utils/sponsoredImages';
import { effectiveEventStatus } from '../utils/eventOpen';

const CARD_BASE =
  'group relative flex flex-col h-full rounded-xl border bg-white dark:bg-gray-900 ' +
  'border-gray-200/80 dark:border-gray-700/80 shadow-sm ' +
  'hover:shadow-md hover:border-red-300/70 dark:hover:border-red-800/50 transition-all duration-200 overflow-hidden';

const CARD_INNER = 'flex flex-col h-full p-4 sm:p-5';

const CARD_ACCENT =
  'absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-red-600 via-red-500 to-red-400 opacity-0 group-hover:opacity-100 transition-opacity';

const statusBadgeClass = (status) => {
  if (status === 'upcoming') return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800';
  if (status === 'live' || status === 'active') return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800';
  if (status === 'locked') return 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800';
  return 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600';
};

const actionBtnClass = (variant) => {
  const base = 'flex-1 min-w-[4.5rem] px-3 py-2.5 rounded-lg text-center text-xs sm:text-sm font-semibold transition-colors';
  if (variant === 'free') return `${base} bg-emerald-600 text-white hover:bg-emerald-700`;
  if (variant === 'boost') return `${base} bg-red-600 text-white hover:bg-red-700`;
  return `${base} border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:border-red-500 hover:text-red-700 dark:hover:border-red-500 dark:hover:text-red-400 bg-gray-50 dark:bg-gray-800/80`;
};

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
  const [allPolls, setAllPolls] = useState([]);
  const [pollImpliedByMarketId, setPollImpliedByMarketId] = useState({});
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
      const sortedStages = [...stagesRes.data].sort((a, b) => (a.order || 0) - (b.order || 0));
      setStages(sortedStages);
      setMatches(matchesRes.data);
      setAwardPolls(pollsRes.data);

      const featuredMatchesData = matchesRes.data.filter((m) => m.isFeatured);
      setFeaturedMatches(featuredMatchesData);
      const sponsoredMatchesData = matchesRes.data.filter((m) => m.isSponsored);
      setSponsoredMatches(sponsoredMatchesData);

      try {
        const allPollsRes = await api.get(`/polls/cup/${cupSlug}`);
        const pollsList = allPollsRes.data || [];
        setAllPolls(pollsList);
        setFeaturedPolls(pollsList.filter((p) => p.isFeatured));
        setSponsoredPolls(pollsList.filter((p) => p.isSponsored));
      } catch (error) {
        console.error('Error fetching polls:', error);
        setAllPolls([]);
        setFeaturedPolls([]);
        setSponsoredPolls([]);
      }

      if (sortedStages.length > 0) {
        const currentStage = sortedStages.find((s) => s.isCurrent || s.currentActive);
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

  const pollsForImplied = useMemo(() => {
    const byId = new Map();
    for (const p of [...allPolls, ...awardPolls, ...featuredPolls, ...sponsoredPolls]) {
      if (p?._id) byId.set(p._id, p);
    }
    return [...byId.values()];
  }, [allPolls, awardPolls, featuredPolls, sponsoredPolls]);

  useEffect(() => {
    if (!pollsForImplied.length) return;
    let cancelled = false;
    (async () => {
      const byMarketId = await fetchPollImpliedBatch(pollsForImplied);
      if (!cancelled) setPollImpliedByMarketId(byMarketId);
    })();
    return () => {
      cancelled = true;
    };
  }, [pollsForImplied]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="animate-spin rounded-full h-11 w-11 border-2 border-red-600 border-t-transparent" />
      </div>
    );
  }

  if (!cup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-gray-600 dark:text-gray-400">Cup not found</p>
      </div>
    );
  }

  const filteredMatches = matches.filter((match) => {
    if (!selectedStage) return true;
    const matchStageId = typeof match.stage === 'object' ? match.stage?._id : match.stage;
    return matchStageId === selectedStage;
  });

  const quickLinks = (
    <>
      <Link
        to={`/leaderboard?cup=${cupSlug}`}
        className="w-full sm:w-auto px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center gap-2 text-sm font-semibold"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
        </svg>
        <span>Leaderboard</span>
      </Link>
      <Link
        to={`/streaks?cup=${cupSlug}`}
        className="w-full sm:w-auto px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 rounded-lg hover:border-red-500 hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center justify-center gap-2 text-sm font-semibold bg-white dark:bg-gray-900"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span>Streaks</span>
      </Link>
      <Link
        to={`/jackpot?cup=${cupSlug}`}
        className="w-full sm:w-auto px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 rounded-lg hover:border-red-500 hover:text-red-600 dark:hover:text-red-400 transition-colors flex items-center justify-center gap-2 text-sm font-semibold bg-white dark:bg-gray-900"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Jackpot</span>
      </Link>
    </>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-6 sm:py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
            <div className="min-w-0">
              <div className="flex items-start gap-4">
                {cup.thumbnailImage ? (
                  <img
                    src={cup.thumbnailImage}
                    alt={cup.name}
                    className="w-14 h-14 sm:w-16 sm:h-16 object-cover rounded-xl border border-gray-200 dark:border-gray-700 flex-shrink-0 shadow-sm"
                  />
                ) : null}
                <div className="min-w-0">
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white mb-1.5 break-words tracking-tight">
                    {cup.name}
                  </h1>
                  {cup.description ? (
                    <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 break-words leading-relaxed">
                      {cup.description}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 flex flex-col sm:flex-row sm:flex-wrap gap-2 md:hidden">{quickLinks}</div>
            </div>
            <div className="hidden md:flex items-center flex-wrap gap-2 justify-end">{quickLinks}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <aside className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-700/80 shadow-sm p-4 sticky top-24">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4">
                Tournament timeline
              </h2>
              <div className="relative">
                <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gray-200 dark:bg-gray-700" />
                <ul className="space-y-1 relative">
                  {stages.map((stage) => {
                    const isSelected = selectedStage === stage._id;
                    const isCurrent = stage.isCurrent || stage.currentActive;
                    return (
                      <li key={stage._id}>
                        <button
                          type="button"
                          onClick={() => setSelectedStage(stage._id)}
                          className={`w-full flex items-start gap-3 text-left px-3 py-2.5 rounded-lg transition-colors ${
                            isSelected
                              ? 'bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-100'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/80'
                          }`}
                        >
                          <span
                            className={`relative z-10 mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                              isCurrent
                                ? 'bg-red-600 ring-4 ring-red-600/20'
                                : isSelected
                                  ? 'bg-red-600'
                                  : 'bg-gray-300 dark:bg-gray-600'
                            }`}
                          />
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-sm truncate">{stage.name}</span>
                              {isCurrent ? (
                                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
                                  Live
                                </span>
                              ) : null}
                            </span>
                            {(stage.startDate || stage.endDate) && (
                              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-500">
                                {stage.startDate && new Date(stage.startDate).toLocaleDateString()}
                                {stage.endDate && ` – ${new Date(stage.endDate).toLocaleDateString()}`}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </aside>

          <div className="lg:col-span-3 space-y-8">
            {selectedStage && (() => {
              const teams = new Map();
              filteredMatches.forEach((match) => {
                if (match.teamA && match.teamAImage) teams.set(match.teamA, match.teamAImage);
                if (match.teamB && match.teamBImage) teams.set(match.teamB, match.teamBImage);
              });
              const teamArray = Array.from(teams.entries()).map(([name, image]) => ({ name, image }));
              const displayCount = 18;
              const showMore = teamArray.length > displayCount;

              if (teamArray.length === 0) return null;

              return (
                <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200/80 dark:border-gray-700/80 shadow-sm p-5 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                      Teams · {stages.find((s) => s._id === selectedStage)?.name || 'Stage'}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowTeamsModal(true)}
                      className="text-sm font-semibold text-red-600 dark:text-red-400 hover:underline"
                    >
                      View all{showMore ? ` (${teamArray.length})` : ''}
                    </button>
                  </div>
                  <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-1.5 sm:gap-2">
                    {teamArray.slice(0, displayCount).map((team, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setShowTeamsModal(true)}
                        className="flex flex-col items-center min-w-0 group px-0.5"
                      >
                        <img
                          src={team.image}
                          alt={team.name}
                          className="w-7 h-7 sm:w-8 sm:h-8 object-cover rounded-full border border-gray-200 dark:border-gray-600 group-hover:border-red-500 transition-colors"
                        />
                        <p className="mt-0.5 text-[9px] sm:text-[10px] leading-tight text-center text-gray-600 dark:text-gray-400 font-medium truncate w-full max-w-[3.25rem] sm:max-w-[3.5rem]">
                          {team.name}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })()}

            {(featuredMatches.length > 0 || featuredPolls.length > 0) && (
              <section>
                <SectionHeading title="Featured" />
                <div className="space-y-6">
                  {featuredMatches.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                        Matches
                      </h3>
                      <CardGrid>
                        {featuredMatches.map((match) => (
                          <MatchCard key={match._id} match={match} featured />
                        ))}
                      </CardGrid>
                    </div>
                  )}
                  {featuredPolls.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                        Polls
                      </h3>
                      <CardGrid>
                        {featuredPolls.map((poll) => (
                          <PollCard
                            key={poll._id}
                            poll={poll}
                            featured
                            impliedByMarketId={pollImpliedByMarketId}
                          />
                        ))}
                      </CardGrid>
                    </div>
                  )}
                </div>
              </section>
            )}

            {(sponsoredMatches.length > 0 || sponsoredPolls.length > 0) && (
              <section className="rounded-xl border border-amber-200/80 dark:border-amber-800/50 bg-gradient-to-b from-amber-50/80 to-white dark:from-amber-950/20 dark:to-gray-900 p-5 sm:p-6">
                <SectionHeading title="Sponsored" icon="⭐" accent="text-amber-800 dark:text-amber-200" />
                <div className="space-y-6">
                  {sponsoredMatches.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-amber-800/80 dark:text-amber-300/90 uppercase tracking-wider mb-3">
                        Matches
                      </h3>
                      <CardGrid>
                        {sponsoredMatches.map((match) => (
                          <MatchCard key={match._id} match={match} sponsored />
                        ))}
                      </CardGrid>
                    </div>
                  )}
                  {sponsoredPolls.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-amber-800/80 dark:text-amber-300/90 uppercase tracking-wider mb-3">
                        Polls
                      </h3>
                      <CardGrid>
                        {sponsoredPolls.map((poll) => (
                          <PollCard
                            key={poll._id}
                            poll={poll}
                            sponsored
                            impliedByMarketId={pollImpliedByMarketId}
                          />
                        ))}
                      </CardGrid>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section>
              <SectionHeading
                title={`Match polls${selectedStage ? ` · ${stages.find((s) => s._id === selectedStage)?.name || ''}` : ''}`}
              />
              {filteredMatches.length > 0 ? (
                <CardGrid>
                  {filteredMatches.map((match) => (
                    <MatchCard key={match._id} match={match} />
                  ))}
                </CardGrid>
              ) : (
                <EmptyState message="No matches in this stage yet." />
              )}
            </section>

            {awardPolls.length > 0 && (
              <section>
                <SectionHeading title="Award polls" />
                <CardGrid>
                  {awardPolls.map((poll) => (
                    <PollCard key={poll._id} poll={poll} impliedByMarketId={pollImpliedByMarketId} />
                  ))}
                </CardGrid>
              </section>
            )}
          </div>
        </div>
      </div>

      {showTeamsModal && selectedStage && (() => {
        const teams = new Map();
        filteredMatches.forEach((match) => {
          if (match.teamA && match.teamAImage) teams.set(match.teamA, match.teamAImage);
          if (match.teamB && match.teamBImage) teams.set(match.teamB, match.teamBImage);
        });
        const teamArray = Array.from(teams.entries()).map(([name, image]) => ({ name, image }));
        if (teamArray.length === 0) return null;

        return (
          <Modal
            isOpen
            onClose={() => setShowTeamsModal(false)}
            title={`Teams · ${stages.find((s) => s._id === selectedStage)?.name || 'Stage'}`}
            size="lg"
          >
            <div className="max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4 p-2">
                {teamArray.map((team, idx) => (
                  <div key={idx} className="flex flex-col items-center">
                    <img
                      src={team.image}
                      alt={team.name}
                      className="w-14 h-14 object-cover rounded-full border-2 border-gray-200 dark:border-gray-700 mb-2"
                    />
                    <p className="text-xs text-center text-gray-700 dark:text-gray-300 font-medium">{team.name}</p>
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

const SectionHeading = ({ title, icon, accent }) => (
  <div className="flex items-center gap-2 mb-4">
    {icon ? <span className="text-xl" aria-hidden>{icon}</span> : null}
    <h2 className={`text-xl sm:text-2xl font-bold tracking-tight ${accent || 'text-gray-900 dark:text-white'}`}>
      {title}
    </h2>
  </div>
);

const CardGrid = ({ children }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">{children}</div>
);

const EmptyState = ({ message }) => (
  <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 py-12 text-center text-gray-500 dark:text-gray-400 text-sm">
    {message}
  </div>
);

const formatGMTTime = (date) => {
  if (!date) return '—';
  return (
    new Date(date).toLocaleString('en-GB', {
      timeZone: 'GMT',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' GMT'
  );
};

const CardActions = ({ freeEnabled, marketEnabled, freeTo, boostTo, marketTo }) => (
  <div className="mt-auto flex flex-wrap gap-2 pt-1">
    {freeEnabled ? (
      <Link to={freeTo} className={actionBtnClass('free')}>
        Free
      </Link>
    ) : null}
    <Link to={boostTo} className={actionBtnClass('boost')}>
      Boost
    </Link>
    {marketEnabled !== false ? (
      <Link to={marketTo} className={actionBtnClass('market')}>
        Market
      </Link>
    ) : null}
  </div>
);

const MatchCard = ({ match, featured = false, sponsored = false }) => {
  const freeEnabled = match.freePredictionEnabled !== false;
  const marketEnabled = match.marketEnabled !== false;
  const { freeJackpot, boostJackpot } = jackpotPoolsFromItem(match);

  return (
    <article
      className={`${CARD_BASE} ${featured ? 'ring-2 ring-red-600/15 dark:ring-red-500/20' : ''} ${
        sponsored ? 'border-amber-300/60 dark:border-amber-700/50' : ''
      }`}
    >
      <div className={CARD_ACCENT} aria-hidden />
      <div className={CARD_INNER}>
        {sponsored && match.sponsoredImages?.length > 0 && (
          <div className="mb-3 pb-3 border-b border-gray-100 dark:border-gray-800">
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">
              Sponsored
            </span>
            <div className="flex gap-2 mt-2 overflow-x-auto">
              {normalizeSponsoredImages(match.sponsoredImages).map((img, idx) => {
                const entry = normalizeSponsoredImageEntry(img);
                if (!entry) return null;
                const inner = (
                  <img
                    src={entry.url}
                    alt=""
                    className="h-12 object-contain rounded-md border border-gray-100 dark:border-gray-800"
                  />
                );
                return entry.link ? (
                  <a
                    key={idx}
                    href={entry.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 hover:opacity-90 transition-opacity"
                  >
                    {inner}
                  </a>
                ) : (
                  <span key={idx} className="shrink-0">{inner}</span>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 sm:gap-3 mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {match.teamAImage ? (
              <img src={match.teamAImage} alt="" className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover flex-shrink-0" />
            ) : null}
            <span className="font-bold text-gray-900 dark:text-white truncate text-sm sm:text-base">{match.teamA}</span>
          </div>
          <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase shrink-0">vs</span>
          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
            <span className="font-bold text-gray-900 dark:text-white truncate text-sm sm:text-base text-right">
              {match.teamB}
            </span>
            {match.teamBImage ? (
              <img src={match.teamBImage} alt="" className="w-9 h-9 sm:w-10 sm:h-10 rounded-full object-cover flex-shrink-0" />
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {match.isResolved ? (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-md border bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600">
                Resolved
              </span>
            ) : null}
            <span
              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-md border ${statusBadgeClass(effectiveEventStatus(match))}`}
            >
              {effectiveEventStatus(match) || '—'}
            </span>
          </div>
          <div className="text-right text-xs text-gray-500 dark:text-gray-400">
            {match.stageName ? <div className="font-medium text-gray-700 dark:text-gray-300">{match.stageName}</div> : null}
            <div className="tabular-nums">{formatGMTTime(match.date)}</div>
          </div>
        </div>

        <JackpotPoolsBanner freeJackpot={freeJackpot} boostJackpot={boostJackpot} compact className="mb-4" />

        <CardActions
          freeEnabled={freeEnabled}
          marketEnabled={marketEnabled}
          freeTo={`/match/${match._id}/free`}
          boostTo={`/match/${match._id}/boost`}
          marketTo={`/match/${match._id}/market`}
        />
      </div>
    </article>
  );
};

const PollCard = ({ poll, sponsored = false, featured = false, impliedByMarketId = {} }) => {
  const freeEnabled = poll.freePredictionEnabled !== false;
  const marketEnabled = poll.marketEnabled !== false;
  const { top, total, hasMore } = rankPollOptionsByImplied(poll, impliedByMarketId, 3);
  const { freeJackpot, boostJackpot } = jackpotPoolsFromItem(poll);

  return (
    <article
      className={`${CARD_BASE} ${featured ? 'ring-2 ring-red-600/15 dark:ring-red-500/20' : ''} ${
        sponsored ? 'border-amber-300/60 dark:border-amber-700/50' : ''
      }`}
    >
      <div className={CARD_ACCENT} aria-hidden />
      <div className={CARD_INNER}>
        {sponsored && poll.sponsoredImages?.length > 0 && (
          <div className="mb-3 pb-3 border-b border-gray-100 dark:border-gray-800">
            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">
              Sponsored
            </span>
            <div className="flex gap-2 mt-2 overflow-x-auto">
              {normalizeSponsoredImages(poll.sponsoredImages).map((img, idx) => {
                const entry = normalizeSponsoredImageEntry(img);
                if (!entry) return null;
                const inner = (
                  <img
                    src={entry.url}
                    alt=""
                    className="h-12 object-contain rounded-md border border-gray-100 dark:border-gray-800"
                  />
                );
                return entry.link ? (
                  <a
                    key={idx}
                    href={entry.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 hover:opacity-90 transition-opacity"
                  >
                    {inner}
                  </a>
                ) : (
                  <span key={idx} className="shrink-0">{inner}</span>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-3 mb-2">
          {poll.thumbnailImage ? (
            <img
              src={poll.thumbnailImage}
              alt=""
              className="w-11 h-11 rounded-lg object-cover border border-gray-200 dark:border-gray-700 flex-shrink-0"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-gray-900 dark:text-white text-sm sm:text-base leading-snug line-clamp-2">
              {poll.question}
            </h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {poll.isResolved ? (
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-md border bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600">
                Resolved
              </span>
            ) : null}
            <span
              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-md border ${statusBadgeClass(effectiveEventStatus(poll))}`}
            >
              {effectiveEventStatus(poll) || '—'}
            </span>
          </div>
          <div className="text-right text-xs text-gray-500 dark:text-gray-400">
            <div className="font-medium text-gray-700 dark:text-gray-300 uppercase">{poll.type || 'poll'}</div>
            <div className="tabular-nums">{formatGMTTime(poll.date || poll.createdAt)}</div>
          </div>
        </div>

        {top.length > 0 && (
          <div className="mb-4 space-y-2.5">
            {top.map((opt) => (
              <div key={opt.key || opt.text} className="flex items-center gap-2.5">
                {opt.image ? (
                  <img src={opt.image} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 shrink-0" aria-hidden />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{opt.text}</span>
                    <span className="shrink-0 text-lg sm:text-xl font-bold tabular-nums text-gray-900 dark:text-white">
                      {opt.pct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-red-600 dark:bg-red-500 transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, opt.pct))}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {hasMore && marketEnabled ? (
              <Link
                to={`/poll/${poll._id}/market`}
                className="inline-block text-xs font-semibold text-red-600 dark:text-red-400 hover:underline"
              >
                +{total - 3} more options →
              </Link>
            ) : null}
          </div>
        )}

        <JackpotPoolsBanner freeJackpot={freeJackpot} boostJackpot={boostJackpot} compact className="mb-4" />

        <CardActions
          freeEnabled={freeEnabled}
          marketEnabled={marketEnabled}
          freeTo={`/poll/${poll._id}/free`}
          boostTo={`/poll/${poll._id}/boost`}
          marketTo={`/poll/${poll._id}/market`}
        />
      </div>
    </article>
  );
};

export default CupPage;
