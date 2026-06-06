import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../components/Notification';
import { useWallet } from '../context/WalletContext';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  buyMarketShares,
  sellMarketShares,
  claimPredictionWinsWithAuth,
  claimOrderbookPositionWithAuth,
  stakeBoost,
  unitsToUsdc,
  addBoostStake,
  withdrawBoostStake,
  getMarketOptions,
  getBlockchainErrorMessage,
  hasSufficientEth,
  setContractAddress,
} from '../utils/blockchain';
import Modal from '../components/Modal';
import FreePredictionModal from '../components/FreePredictionModal';
import PhoneVerificationModal from '../components/PhoneVerificationModal';
import NftHolderBonusesSection from '../components/NftHolderBonusesSection';
import { useFreeTicketData } from '../hooks/useFreeTicketData';
import TicketBalanceCards from '../components/TicketBalanceCards';
import WalletInUseModal from '../components/WalletInUseModal';
import OrderbookTradePanel from '../components/OrderbookTradePanel';
import { formatUsdAmount } from '../utils/money';
import { formatMarketOrderbookOutcomeLabel } from '../utils/marketLabels';
import {
  boostOutcomeStatsKey,
  estimateBoostPotentialWin,
  estimateFreeJackpotPotentialWin,
  estimateMarketOrderbookPotentialWin,
} from '../utils/predictionPayout';

/** Draw outcome avatar when no team image is set. */
function DrawOutcomeAvatar({ className = 'w-11 h-11' }) {
  return (
    <div
      className={`${className} rounded-full border border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0`}
      aria-hidden
    >
      <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" d="M4 12h16M12 4v16" />
      </svg>
    </div>
  );
}

function OutcomeOptionAvatar({ image, label, sizeClass = 'w-11 h-11' }) {
  if (image === 'draw-icon') return <DrawOutcomeAvatar className={sizeClass} />;
  if (image) {
    return (
      <img
        src={image}
        alt={label || ''}
        className={`${sizeClass} rounded-full object-cover border border-slate-200 dark:border-slate-600 shrink-0`}
      />
    );
  }
  return <div className={`${sizeClass} rounded-full bg-slate-200 dark:bg-slate-700 shrink-0`} />;
}

async function ensureGasOrDrip(walletAddress, { label, showNotification } = {}) {
  if (!walletAddress) return true;
  try {
    const enoughGasNow = await hasSufficientEth(walletAddress, 0);
    if (enoughGasNow) return true;

    // Request drip
    try {
      const { data } = await api.post('/relayer/gasdrip', { walletAddress });
      if (data?.sent) {
        showNotification?.('Gas funded for you. Finalizing…', 'success');
      } else {
        showNotification?.('Gas balance is sufficient. Continuing…', 'info');
        return true;
      }
    } catch (e) {
      showNotification?.(
        e?.response?.data?.message ||
          `Unable to fund gas${label ? ` for ${label}` : ''}. Please add a little Base ETH.`,
        'error'
      );
      return false;
    }

    // Wait for balance to update (RPC + chain finality)
    for (let i = 0; i < 12; i++) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 1000));
      try {
        // eslint-disable-next-line no-await-in-loop
        const ok = await hasSufficientEth(walletAddress, 0);
        if (ok) return true;
      } catch (_) {
        // ignore
      }
    }

    showNotification?.('Gas was funded but has not arrived yet. Please try again in a moment.', 'warning');
    return false;
  } catch (_) {
    // If gas check fails, do not block the user from trying
    return true;
  }
}

/** Order lifecycle field on Order documents (not match/poll status). */
function normalizeTradeOrderStatus(orderDoc) {
  const raw = orderDoc && Object.prototype.hasOwnProperty.call(orderDoc, 'status') ? orderDoc.status : '';
  const s = String(raw ?? '')
    .toLowerCase()
    .trim();
  return s;
}

/** Normalize API order status for display (avoids wrong "Filled" when casing or shape differs). */
function formatOrderbookOrderStatusLabel(statusRaw) {
  const s = String(statusRaw ?? '')
    .toLowerCase()
    .trim();
  if (!s) return { label: '—', filled: false };
  if (s === 'filled') return { label: 'Filled', filled: true };
  const label = s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { label, filled: false };
}

const MatchDetail = () => {
  const { matchId, pollId, type } = useParams();
  const [match, setMatch] = useState(null);
  const [poll, setPoll] = useState(null);
  const [loading, setLoading] = useState(true);
  const [prediction, setPrediction] = useState(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showNotification } = useNotification();
  const { account, ensureConnected, disconnect } = useWallet();
  const [walletInUseOpen, setWalletInUseOpen] = useState(false);
  const [walletInUseAddress, setWalletInUseAddress] = useState(null);
  
  // Set contract address on mount
  useEffect(() => {
    const contractAddr = process.env.REACT_APP_CONTRACT_ADDRESS;
    if (contractAddr) {
      setContractAddress(contractAddr);
    }
  }, []);

  const isPoll = !!pollId;
  const itemId = pollId || matchId;

  const ensureLinkedWallet = useCallback(async () => {
    const addr = account || (await ensureConnected());
    if (!addr) throw new Error('Wallet not connected');
    try {
      await api.post('/auth/wallets/link', { address: addr });
      return addr;
    } catch (e) {
      if (e?.response?.status === 409) {
        setWalletInUseAddress(addr);
        setWalletInUseOpen(true);
        throw new Error('WALLET_IN_USE');
      }
      throw e;
    }
  }, [account, ensureConnected]);

  // Check if predictions are locked
  const isLocked = useCallback(() => {
    const item = match || poll;
    if (!item) return false;
    if (item.status === 'locked') return true;
    if (item.lockedTime) {
      const now = new Date();
      const lockedTime = new Date(item.lockedTime);
      return now >= lockedTime;
    }
    return false;
  }, [match, poll]);

  const fetchData = useCallback(async () => {
    try {
      if (isPoll) {
        const response = await api.get(`/polls/${pollId}`);
        setPoll(response.data);
      } else {
        const response = await api.get(`/matches/${matchId}`);
        setMatch(response.data);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [isPoll, pollId, matchId]);

  const fetchUserPrediction = useCallback(async () => {
    try {
      // Fetch prediction by type to avoid mixing free and boost predictions
      const endpoint = isPoll 
        ? `/predictions/poll/${pollId}/user?type=${type}`
        : `/predictions/match/${matchId}/user?type=${type}`;
      const response = await api.get(endpoint);
      // Handle both single prediction and array (for market type)
      const predictionData = Array.isArray(response.data) ? response.data[0] : response.data;
      setPrediction(predictionData);
    } catch (error) {
      // User hasn't predicted yet for this type - 404 is expected
      if (error.response?.status !== 404) {
        console.error('Error fetching prediction:', error);
      }
      setPrediction(null);
    }
  }, [isPoll, pollId, matchId, type]);

  useEffect(() => {
    fetchData();
    if (user) {
      fetchUserPrediction();
    }
  }, [itemId, user, isPoll, type, fetchData, fetchUserPrediction]);
  
  // Refresh prediction when item resolution status changes
  useEffect(() => {
    if (!user) return;
    const item = match || poll;
    if (item?.isResolved) {
      const timer = setTimeout(() => {
        fetchUserPrediction();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [match, poll, user, fetchUserPrediction]);

  const handlePredict = async (outcome, amount = null) => {
    if (!user) {
      showNotification('Please login to make predictions', 'warning');
      return;
    }

    // Check if locked
    const item = match || poll;
    if (item && (item.status === 'locked' || (item.lockedTime && new Date() >= new Date(item.lockedTime)))) {
      showNotification('Predictions are locked for this match/poll', 'error');
      return;
    }

    try {
      // Check if prediction exists and item is still upcoming
      const canUpdate = prediction && item && (item.status === 'upcoming' || item.status === 'active');
      
      if (type === 'free') {
        if (canUpdate) {
          // Update existing prediction
          await api.put(`/predictions/${prediction._id}`, { outcome });
          showNotification('Prediction updated successfully!', 'success');
        } else {
          // Create new prediction
          console.log(`[FREE PREDICTION] Attempting to create prediction for ${isPoll ? 'poll' : 'match'}: ${itemId}, outcome: ${outcome}`);
          try {
            const ticketsToStake = amount != null ? Math.max(1, parseInt(amount, 10) || 1) : Math.max(1, parseInt(item.minFreeTickets, 10) || 1);
            const response = await api.post('/predictions/free', {
              [isPoll ? 'pollId' : 'matchId']: itemId,
              outcome,
              ticketsToStake,
            });
            console.log('[FREE PREDICTION] Prediction created successfully:', response.data);
            showNotification('Free prediction submitted successfully!', 'success');
          } catch (error) {
            console.error('[FREE PREDICTION] Error creating prediction:', error.response?.data || error.message);
            showNotification(error.response?.data?.message || 'Failed to create prediction', 'error');
            throw error; // Re-throw to prevent further execution
          }
        }
      } else if (type === 'boost') {
        // Wallet will auto-connect when blockchain function is called
        
        if (canUpdate) {
          // Update existing prediction - amount is automatically preserved
          // No blockchain call needed for updating outcome only
          await api.put(`/predictions/${prediction._id}`, { outcome });
          showNotification('Prediction updated successfully! Your stake amount has been preserved.', 'success');
        } else {
          // Create new prediction - amount is required
          if (!amount) {
            showNotification('Please enter an amount to stake', 'warning');
            return;
          }
          const amountNum = parseFloat(amount);
          if (Number.isNaN(amountNum) || amountNum <= 0) {
            showNotification('Please enter a valid amount to stake', 'warning');
            return;
          }
          
          // Get item to get marketId - refresh to ensure we have latest data
          const currentItem = match || poll;
          if (!currentItem) {
            showNotification('Match/Poll data not found', 'error');
            return;
          }
          
          // Check if marketId exists and market is initialized
          if (!currentItem.marketId) {
            showNotification('Market not created on blockchain yet. Please wait for admin to create the market.', 'error');
            console.error('MarketId missing for item:', currentItem._id, 'Item data:', currentItem);
            return;
          }
          
          if (!currentItem.marketInitialized) {
            showNotification('Market is not initialized yet. Please wait for admin to initialize the market.', 'error');
            return;
          }
          
          // Normalize outcome to match contract options exactly (match: TeamA/Draw/TeamB; poll YES/NO or custom option text)
          let normalizedOutcome = String(outcome || '').trim();
          if (!isPoll) {
            const lower = normalizedOutcome.toLowerCase();
            const teamALower = (currentItem.teamA || '').trim().toLowerCase();
            const teamBLower = (currentItem.teamB || '').trim().toLowerCase();
            if (lower === 'teama' || (teamALower && lower === teamALower)) {
              normalizedOutcome = 'TeamA';
            } else if (lower === 'teamb' || (teamBLower && lower === teamBLower)) {
              normalizedOutcome = 'TeamB';
            } else if (lower === 'draw') {
              normalizedOutcome = 'Draw';
            }
            const allowed = currentItem.contractOutcomes || ['TeamA', 'Draw', 'TeamB'];
            if (!allowed.includes(normalizedOutcome)) {
              showNotification('Could not determine outcome for this match. Please select Team A, Draw, or Team B.', 'error');
              return;
            }
          } else {
            if (currentItem?.optionType === 'options' && Array.isArray(currentItem?.options) && currentItem.options.length > 0) {
              const matchOpt = currentItem.options.find(
                (o) => o && String(o.text).trim().toLowerCase() === normalizedOutcome.toLowerCase()
              );
              if (!matchOpt) {
                showNotification('Invalid option for this poll. Please refresh and try again.', 'error');
                return;
              }
              normalizedOutcome = String(matchOpt.text).trim();
            } else {
              normalizedOutcome = normalizedOutcome.toUpperCase();
            }
          }

          // Check wallet gas balance before popping wallet for signature.
          try {
            const linked = await ensureLinkedWallet();
            if (linked) {
              const ok = await ensureGasOrDrip(linked, { label: 'boost stake' });
              if (!ok) return;
            }
          } catch (e) {
            if (String(e?.message || '') === 'WALLET_IN_USE') return;
            console.warn('Could not verify wallet balance before boost stake:', e);
          }
          
          try {
            // Validate outcome against contract options so we get a clear error instead of "missing revert data"
            let contractOptions = [];
            try {
              contractOptions = await getMarketOptions(currentItem.marketId);
            } catch (e) {
              console.warn('Could not fetch market options from chain:', e);
            }
            if (contractOptions.length > 0) {
              const outcomeTrimmed = String(normalizedOutcome || '').trim();
              const isAllowed = contractOptions.some(
                (opt) => String(opt || '').trim() === outcomeTrimmed
              );
              if (!isAllowed) {
                showNotification(
                  `Your selection is not a valid option for this market on the blockchain. Valid options: ${contractOptions.join(', ')}. Please refresh or contact admin.`,
                  'error'
                );
                return;
              }
            }
            // Stake on blockchain first - wait for transaction to complete
            showNotification('Sending transaction to blockchain...', 'info');
            const txHash = await stakeBoost(currentItem.marketId, normalizedOutcome, parseFloat(amount));
            showNotification(`Transaction confirmed! TX: ${txHash.slice(0, 10)}...`, 'success');

            try {
              await api.post('/transactions', {
                action: 'boost_stake',
                txHash,
                amount: parseFloat(amount),
                currency: 'USDC',
                itemType: isPoll ? 'poll' : 'match',
                itemId,
                meta: { outcome: normalizedOutcome },
              });
            } catch {
              // ignore logging failures
            }
            
            // Then create in backend only after blockchain success (send wallet so backend can set claimable on resolve)
            const linked = await ensureLinkedWallet();
            await api.post('/predictions/boost', {
              [isPoll ? 'pollId' : 'matchId']: itemId,
              outcome,
              amount: parseFloat(amount),
              type: 'boost',
              walletAddress: linked || undefined,
              txHash,
            });
            showNotification('Boost prediction submitted successfully!', 'success');
          } catch (blockchainError) {
            console.error('Blockchain transaction failed:', blockchainError);
            const msg = getBlockchainErrorMessage(blockchainError);
            showNotification(msg, 'error');
            throw blockchainError; // Re-throw to prevent backend call
          }
        }
      }
      
      // Refresh item data to get updated stats (like freePredictions count, boostPool, etc.)
      await fetchData();
      await fetchUserPrediction();
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to submit prediction', 'error');
    }
  };

  const handleStakeAction = async (predictionId, action, amount) => {
    // Wallet will auto-connect when blockchain function is called
    
    try {
      const item = match || poll;
      if (!item || !item.marketId) {
        showNotification('Market not created on blockchain yet', 'error');
        console.error('MarketId missing for item:', item?._id, 'Item data:', item);
        return;
      }

      const stakeIsPoll = Boolean(item.question);
      
      if (!item.marketInitialized) {
        showNotification('Market is not initialized yet', 'error');
        return;
      }
      
      // Get prediction to get outcome - but handle case where it might not exist
      let prediction = null;
      let normalizedOutcome = null;
      
      try {
        const predResponse = await api.get(`/predictions/${predictionId}`);
        prediction = predResponse.data;
        normalizedOutcome = prediction.outcome;
      } catch (predError) {
        // If prediction doesn't exist, try to get it from user predictions
        try {
          const endpoint = isPoll 
            ? `/predictions/poll/${item._id}/user?type=boost`
            : `/predictions/match/${item._id}/user?type=boost`;
          const response = await api.get(endpoint);
          prediction = response.data;
          if (prediction) {
            normalizedOutcome = prediction.outcome;
          } else {
            throw new Error('Prediction not found');
          }
        } catch (err) {
          showNotification('Could not find prediction. Please make a prediction first.', 'error');
          return;
        }
      }
      
      if (!normalizedOutcome) {
        showNotification('Could not determine outcome', 'error');
        return;
      }
      
      // Normalize outcome to match contract options exactly
      if (!isPoll) {
        const lower = String(normalizedOutcome || '').trim().toLowerCase();
        const teamALower = (item.teamA || '').trim().toLowerCase();
        const teamBLower = (item.teamB || '').trim().toLowerCase();
        if (lower === 'teama' || (teamALower && lower === teamALower)) {
          normalizedOutcome = 'TeamA';
        } else if (lower === 'teamb' || (teamBLower && lower === teamBLower)) {
          normalizedOutcome = 'TeamB';
        } else if (lower === 'draw') {
          normalizedOutcome = 'Draw';
        }
      } else {
        if (item?.optionType === 'options' && Array.isArray(item?.options) && item.options.length > 0) {
          const matchOpt = item.options.find(
            (o) => o && String(o.text).trim().toLowerCase() === String(normalizedOutcome).trim().toLowerCase()
          );
          normalizedOutcome = matchOpt ? String(matchOpt.text).trim() : normalizedOutcome.toUpperCase();
        } else {
          normalizedOutcome = normalizedOutcome.toUpperCase();
        }
      }
      
      try {
        let txHash = '';
        if (action === 'add') {
          // Add stake on blockchain first
          showNotification('Sending transaction to blockchain...', 'info');
          txHash = await addBoostStake(item.marketId, normalizedOutcome, parseFloat(amount));
          showNotification(`Transaction confirmed! TX: ${txHash.slice(0, 10)}...`, 'success');
        } else if (action === 'withdraw') {
          // Withdraw stake on blockchain first
          showNotification('Sending transaction to blockchain...', 'info');
          txHash = await withdrawBoostStake(item.marketId, normalizedOutcome, parseFloat(amount));
          showNotification(`Transaction confirmed! TX: ${txHash.slice(0, 10)}...`, 'success');
        }

        if (txHash) {
          try {
            await api.post('/transactions', {
              action: action === 'add' ? 'boost_add_stake' : 'boost_withdraw_stake',
              txHash,
              amount: parseFloat(amount),
              currency: 'USDC',
              itemType: stakeIsPoll ? 'poll' : 'match',
              itemId: item._id,
              meta: { outcome: normalizedOutcome },
            });
          } catch {
            // ignore
          }
        }
        
        // Then update backend only after blockchain success
        const actualPredictionId = prediction?._id || predictionId;
        const linked = await ensureLinkedWallet();
        await api.post(`/predictions/boost/${actualPredictionId}/stake`, {
          action,
          amount: parseFloat(amount),
          walletAddress: linked || undefined,
          txHash: txHash || undefined,
        });
        showNotification(`Stake ${action === 'add' ? 'added' : 'withdrawn'} successfully!`, 'success');
        await fetchUserPrediction();
        await fetchData();
      } catch (blockchainError) {
        console.error('Blockchain transaction failed:', blockchainError);
        showNotification(getBlockchainErrorMessage(blockchainError), 'error');
        throw blockchainError; // Re-throw to prevent backend call
      }
    } catch (error) {
      console.error('Error in stake action:', error);
      showNotification(error.message || `Failed to ${action} stake`, 'error');
    }
  };

  const handleClaim = async () => {
    try {
      const predictions = await api.get('/claims/user');
      const claimable = predictions.data.filter(p => p.status === 'won' && p.payout > 0);
      
      if (claimable.length === 0) {
        showNotification('No claims available', 'info');
        return;
      }

      await api.post('/claims/claim/all');
      showNotification('All claims processed successfully!', 'success');
      await fetchUserPrediction();
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to claim', 'error');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!match && !poll) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">{isPoll ? 'Poll' : 'Match'} not found</p>
      </div>
    );
  }

  const item = match || poll;

  const locked = isLocked();

  let view = null;
  if (type === 'free') {
    view = (
      <FreeMatchView
        item={item}
        isPoll={isPoll}
        prediction={prediction}
        onPredict={handlePredict}
        onClaim={handleClaim}
        navigate={navigate}
        locked={locked}
        account={account}
      />
    );
  } else if (type === 'boost') {
    view = (
      <BoostMatchView
        item={item}
        isPoll={isPoll}
        prediction={prediction}
        onPredict={handlePredict}
        onStakeAction={handleStakeAction}
        onClaim={handleClaim}
        navigate={navigate}
        locked={locked}
        onRefreshPrediction={fetchUserPrediction}
        walletAddress={account}
      />
    );
  } else if (type === 'market') {
    view = (
      <MarketMatchView
        item={item}
        isPoll={isPoll}
        navigate={navigate}
        user={user}
        showNotification={showNotification}
        locked={locked}
        ensureLinkedWallet={ensureLinkedWallet}
        onItemUpdate={(updatedItem) => {
          if (isPoll) {
            setPoll(updatedItem);
          } else {
            setMatch(updatedItem);
          }
        }}
      />
    );
  }

  return (
    <>
      <WalletInUseModal
        isOpen={walletInUseOpen}
        walletAddress={walletInUseAddress}
        onDisconnect={() => {
          try {
            disconnect();
          } finally {
            setWalletInUseOpen(false);
            setWalletInUseAddress(null);
          }
        }}
      />
      {view}
    </>
  );
};

const FreeMatchView = ({ item, isPoll, prediction, onPredict, onClaim, navigate, locked = false, account }) => {
  const { user, refreshUser } = useAuth();
  const { ensureConnected, isConnecting } = useWallet();
  const { showNotification } = useNotification();
  const [showPredictModal, setShowPredictModal] = useState(false);
  const [selectedOutcome] = useState(null);
  const [freePickerOpen, setFreePickerOpen] = useState(false);
  const [phoneVerifyOpen, setPhoneVerifyOpen] = useState(false);
  const [pendingFreePick, setPendingFreePick] = useState(null);
  const [freePickerOutcome, setFreePickerOutcome] = useState(null);
  const [freePickerOutcomeImage, setFreePickerOutcomeImage] = useState(null);
  const [freePredictLoading, setFreePredictLoading] = useState(false);
  const [freeJackpotStats, setFreeJackpotStats] = useState(null);
  const [linkingFreeWallet, setLinkingFreeWallet] = useState(false);
  const {
    balances: freeTicketBalances,
    nftBonuses: freeNftBonuses,
    verifying: freeTicketsVerifying,
    balancesLoading: freeTicketsLoading,
    reload: reloadFreeTicketData,
  } = useFreeTicketData(user, account);
  const minTickets = Math.max(1, parseInt(item.minFreeTickets, 10) || 1);

  const fetchFreeJackpotStats = useCallback(async () => {
    const itemId = item?._id;
    if (!itemId) return;
    try {
      const path = isPoll
        ? `/predictions/poll/${itemId}/free-jackpot-stats`
        : `/predictions/match/${itemId}/free-jackpot-stats`;
      const { data } = await api.get(path);
      setFreeJackpotStats(data);
    } catch (e) {
      console.warn('free-jackpot-stats', e?.message || e);
    }
  }, [item?._id, isPoll]);

  useEffect(() => {
    fetchFreeJackpotStats();
  }, [fetchFreeJackpotStats, item?.freeJackpotPool]);

  const handleFreeConnectWallet = async () => {
    if (!user) {
      showNotification('Please log in first', 'warning');
      return;
    }
    setLinkingFreeWallet(true);
    try {
      const addr = account || (await ensureConnected());
      if (!addr) return;
      await api.post('/auth/wallets/link', { address: addr });
      showNotification('Wallet linked — verifying NFT/FT holdings on-chain…', 'success');
      await reloadFreeTicketData();
    } catch (e) {
      showNotification(e.response?.data?.message || e.message || 'Could not connect wallet', 'error');
    } finally {
      setLinkingFreeWallet(false);
    }
  };

  const isResolved = item.isResolved;
  const getDisplayOutcome = (rawOutcome) => {
    if (!rawOutcome) return '';
    return formatMarketOrderbookOutcomeLabel(String(rawOutcome).trim(), item, isPoll);
  };

  // Map result to display name: TeamA -> teamA name, TeamB -> teamB name, Draw -> Draw
  const getDisplayResult = () => {
    if (!item.result) return '';
    const result = item.result.trim();
    if (result === 'TeamA' || result.toLowerCase() === 'teama') {
      return item.teamA || 'Team A';
    } else if (result === 'TeamB' || result.toLowerCase() === 'teamb') {
      return item.teamB || 'Team B';
    } else if (result === 'Draw' || result.toLowerCase() === 'draw') {
      return 'Draw';
    }
    // If result is already a team name, return it as is
    return result;
  };
  const resolvedOutcome = getDisplayResult();
  // Check if won: status is 'won' (more robust check like boost)
  const hasWon = prediction && (
    prediction.status === 'won' ||
    (prediction.status === 'settled' && prediction.status !== 'lost') ||
    (isResolved && prediction.outcome && resolvedOutcome && 
     (prediction.outcome.trim().toUpperCase() === resolvedOutcome.trim().toUpperCase() ||
      prediction.outcome.trim() === resolvedOutcome.trim() ||
      (prediction.outcome.trim().toLowerCase() === 'yes' && resolvedOutcome.trim().toUpperCase() === 'YES') ||
      (prediction.outcome.trim().toUpperCase() === 'YES' && resolvedOutcome.trim().toLowerCase() === 'yes')))
  );

  const effectiveFreeJackpotPool =
    freeJackpotStats?.freeJackpotPool ??
    (item.isResolved && item.originalFreeJackpotPool
      ? item.originalFreeJackpotPool
      : item.freeJackpotPool || 0);

  const freePotentialWin = (pred) => {
    if (!pred || isResolved) return null;
    const userTickets = Math.max(1, parseInt(pred.ticketsStaked, 10) || 1);
    const outcomeKey = boostOutcomeStatsKey(pred.outcome, item, isPoll);
    const outcomeTotal = Number(freeJackpotStats?.ticketsByOutcome?.[outcomeKey]) || userTickets;
    return estimateFreeJackpotPotentialWin({
      freeJackpotPoolUsdc: effectiveFreeJackpotPool,
      userTickets,
      outcomeTotalTickets: outcomeTotal,
    });
  };
  
  const getOutcomeOptions = () => {
    if (isPoll) {
      if (item.optionType === 'options' && item.options) {
        return item.options.map(opt => ({ text: opt.text, image: opt.image }));
      }
      return ['YES', 'NO'];
    }
    const rows = [
      { text: item.teamA, image: item.teamAImage },
      { text: item.teamB, image: item.teamBImage },
    ];
    if (item.drawEnabled !== false) {
      rows.splice(1, 0, { text: 'Draw', image: 'draw-icon' });
    }
    return rows;
  };

  const openFreePicker = (optionText, optionImage = null) => {
    if (locked) return;
    if (!user) {
      showNotification('Please log in to make a free prediction', 'warning');
      return;
    }
    if (!user.phoneVerified) {
      setPendingFreePick({ optionText, optionImage });
      setPhoneVerifyOpen(true);
      return;
    }
    setFreePickerOutcome(optionText);
    setFreePickerOutcomeImage(optionImage);
    setFreePickerOpen(true);
  };

  const continuePendingFreePick = useCallback(() => {
    if (!pendingFreePick) return;
    setFreePickerOutcome(pendingFreePick.optionText);
    setFreePickerOutcomeImage(pendingFreePick.optionImage);
    setPendingFreePick(null);
    setFreePickerOpen(true);
  }, [pendingFreePick]);

  const handlePhoneVerified = useCallback(async () => {
    setPhoneVerifyOpen(false);
    await refreshUser?.();
    continuePendingFreePick();
  }, [refreshUser, continuePendingFreePick]);

  const confirmFreePick = async (stake) => {
    setFreePredictLoading(true);
    try {
      await onPredict(freePickerOutcome, stake);
      await Promise.all([fetchFreeJackpotStats(), reloadFreeTicketData()]);
      setFreePickerOpen(false);
      setShowPredictModal(false);
    } finally {
      setFreePredictLoading(false);
    }
  };

  const handleBack = () => {
    if (item.cup && item.cup.slug) {
      navigate(`/cup/${item.cup.slug}`);
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
          {/* Back Button and Status Tags */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={handleBack}
              className="flex items-center text-gray-600 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-medium">Back to Cup</span>
            </button>
            <div className="flex items-center gap-2">
              {/* Status Tag */}
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                isPoll 
                  ? (item.status === 'upcoming' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                     item.status === 'active' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                     item.status === 'locked' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                     'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200')
                  : (item.status === 'upcoming' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                     item.status === 'live' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                     item.status === 'locked' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                     'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200')
              }`}>
                {item.status?.toUpperCase() || 'N/A'}
              </span>
              {/* Resolved Tag */}
              {item.isResolved && (
                <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
                  RESOLVED
                </span>
              )}
            </div>

          </div>
          {/* Header with Images */}
          {!isPoll && (
            <div className="flex items-center justify-center gap-8 mb-6">
              <div className="flex flex-col items-center">
                {item.teamAImage && (
                  <img src={item.teamAImage} alt={item.teamA} className="w-24 h-24 object-cover rounded-full mb-2 border-4 border-gray-200 dark:border-gray-700" />
                )}
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{item.teamA}</h2>
              </div>
              <div className="text-2xl font-bold text-gray-500 dark:text-gray-400">VS</div>
              <div className="flex flex-col items-center">
                {item.teamBImage && (
                  <img src={item.teamBImage} alt={item.teamB} className="w-24 h-24 object-cover rounded-full mb-2 border-4 border-gray-200 dark:border-gray-700" />
                )}
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{item.teamB}</h2>
              </div>
            </div>
          )}
          {isPoll ? (
            <div className="flex items-start gap-4 mb-6">
              {item.thumbnailImage ? (
                <img
                  src={item.thumbnailImage}
                  alt={item.question}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700 flex-shrink-0"
                />
              ) : null}
              <div className="min-w-0">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 text-left break-words">
                  {item.question}
                </h1>
                <p className="text-gray-600 dark:text-gray-400 text-left break-words">
                  {item.description}
                </p>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 text-center">
                {`${item.teamA} vs ${item.teamB}`}
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-6 text-center">
                {`${new Date(item.date).toLocaleDateString()} • ${item.stageName || ''}`}
              </p>
            </>
          )}

          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800 mb-6">
            <div className="text-sm text-green-600 dark:text-green-400 font-semibold mb-1">Jackpot pool</div>
            <div className="text-xl font-bold text-green-700 dark:text-green-300">
              {formatUsdAmount(effectiveFreeJackpotPool)}
            </div>
            <p className="text-xs text-green-700/80 dark:text-green-300/80 mt-1">
              Split among winning free picks by tickets staked on that outcome.
            </p>
          </div>

          {isResolved && (
            <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Resolved Outcome
              </h2>
              <p className="text-lg text-gray-900 dark:text-white">
                Result: <strong>{resolvedOutcome}</strong>
              </p>
            </div>
          )}

          <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              FREE Prediction
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Use your daily free ticket to predict the outcome. Earn points and compete for jackpots!
            </p>
          </div>

          {user && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 mb-6 space-y-4 bg-slate-50/80 dark:bg-slate-900/40">
              {user.phoneVerified ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <span className="inline-flex w-4 h-4 rounded-full bg-emerald-600 text-white items-center justify-center text-[10px] font-bold">
                    ✓
                  </span>
                  Phone verified{user.phoneMasked ? ` · ${user.phoneMasked}` : ''}
                </p>
              ) : (
                <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  Verify your mobile number once to place free predictions (SMS code).
                </p>
              )}
              <TicketBalanceCards
                user={user}
                balances={freeTicketBalances}
                loading={freeTicketsLoading}
                compact
              />
              <NftHolderBonusesSection
                nftBonuses={freeNftBonuses}
                user={user}
                account={account}
                verifying={freeTicketsVerifying}
                onConnectWallet={handleFreeConnectWallet}
                linkingWallet={linkingFreeWallet}
                isConnecting={isConnecting}
                compact
              />
            </div>
          )}

          {prediction ? (
            <div className={`rounded-lg p-6 mb-6 ${hasWon ? 'bg-green-50 dark:bg-green-900' : 'bg-gray-50 dark:bg-gray-700'}`}>
              <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Your Prediction: {getDisplayOutcome(prediction.outcome)}
              </p>
              {isResolved && (
                <p className={`text-lg mb-2 ${hasWon ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                  Status: {hasWon ? '✅ Won' : '❌ Lost'}
                </p>
              )}
              {!isResolved && (
                <>
                  <p className="text-gray-600 dark:text-gray-400 mb-1">
                    Status: Pending
                  </p>
                  <p className="text-gray-600 dark:text-gray-400 mb-1">
                    Tickets played:{' '}
                    <strong>{Math.max(1, parseInt(prediction.ticketsStaked, 10) || 1)}</strong>
                  </p>
                  {(() => {
                    const potWin = freePotentialWin(prediction);
                    if (freeJackpotStats == null && !isResolved) {
                      return (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                          Potential win:{' '}
                          <span className="inline-block h-4 w-16 rounded bg-slate-200 dark:bg-slate-600 animate-pulse align-middle" />
                        </p>
                      );
                    }
                    return potWin != null && Number.isFinite(potWin) ? (
                      <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                        Potential win if correct: {formatUsdAmount(potWin)}
                      </p>
                    ) : null;
                  })()}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Based on jackpot pool ({formatUsdAmount(effectiveFreeJackpotPool)}) and your
                    ticket share vs others on the same pick.
                  </p>
                </>
              )}
              {/* {canPredict && (
                <button
                  onClick={() => {
                    setSelectedOutcome(getDisplayOutcome(prediction.outcome));
                    setShowPredictModal(true);
                  }}
                  className="mt-4 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Update Prediction
                </button>
              )} */}
              {locked && (
                <p className="mt-4 px-4 py-2 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded-lg">
                  Predictions are locked for this match/poll
                </p>
              )}
            </div>
          ) : isResolved ? (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6 mb-6">
              <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                You did not predict
              </p>
              <p className="text-gray-600 dark:text-gray-400">
                This {isPoll ? 'poll' : 'match'} has been resolved, but you did not make a prediction for it.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {getOutcomeOptions().map((option, index) => {
                const optionText = typeof option === 'string' ? option : option.text;
                const optionImage = typeof option === 'object' ? option.image : null;
                return (
                  <button
                    key={optionText}
                    onClick={() => openFreePicker(optionText, optionImage)}
                    className="w-full px-6 py-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-lg font-semibold text-gray-900 dark:text-white transition-colors flex items-center justify-center gap-3"
                  >
                    {(optionImage === 'draw-icon' || optionImage) && (
                      <OutcomeOptionAvatar image={optionImage} label={optionText} sizeClass="w-12 h-12" />
                    )}
                    <span>{optionText} {isPoll ? '' : 'Wins'}</span>
                  </button>
                );
              })}
            </div>
          )}

          <PhoneVerificationModal
            open={phoneVerifyOpen}
            onClose={() => {
              setPhoneVerifyOpen(false);
              setPendingFreePick(null);
            }}
            onVerified={handlePhoneVerified}
            outcomePreview={
              pendingFreePick
                ? `${pendingFreePick.optionText}${isPoll ? '' : ' Wins'}`
                : null
            }
          />

          <FreePredictionModal
            open={freePickerOpen}
            onClose={() => setFreePickerOpen(false)}
            outcomeLabel={freePickerOutcome || 'Confirm'}
            outcomeImage={freePickerOutcomeImage}
            outcomeSuffix={isPoll ? '' : ' Wins'}
            minTickets={minTickets}
            onConfirm={confirmFreePick}
            loading={freePredictLoading}
          />

          {showPredictModal && (
            <Modal isOpen={true} onClose={() => setShowPredictModal(false)} title="Update Prediction">
              <div className="space-y-4">
                <p className="text-gray-700 dark:text-gray-300 mb-4">
                  Select a new outcome:
                </p>
                <div className="space-y-2">
                  {getOutcomeOptions().map((option, index) => {
                    const optionText = typeof option === 'string' ? option : option.text;
                    const optionImage = typeof option === 'object' ? option.image : null;
                    return (
                      <button
                        key={optionText}
                        onClick={() => {
                          if (!locked) {
                            setShowPredictModal(false);
                            openFreePicker(optionText, optionImage);
                          }
                        }}
                        disabled={locked}
                        className={`w-full px-4 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-3 ${
                          locked
                            ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                            : selectedOutcome === optionText
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {optionImage === 'draw-icon' ? (
                          <DrawOutcomeAvatar className="w-8 h-8" />
                        ) : optionImage ? (
                          <img src={optionImage} alt={optionText} className="w-8 h-8 object-cover rounded-full" />
                        ) : null}
                        <span>{optionText} {isPoll ? '' : 'Wins'}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setShowPredictModal(false)}
                  className="w-full px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </Modal>
          )}
        </div>
      </div>
    </div>
  );
};

const BoostMatchView = ({
  item,
  isPoll,
  prediction,
  onPredict,
  onStakeAction,
  onClaim,
  navigate,
  locked = false,
  onRefreshPrediction,
  walletAddress,
}) => {
  // USDC ~ USD; no ETH conversion hints
  const [showPredictModal, setShowPredictModal] = useState(false);
  const [showStakeModal, setShowStakeModal] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState(null);
  const [amount, setAmount] = useState('');
  const [stakeAction] = useState('add'); // 'add' or 'withdraw' (setter intentionally unused)
  const [stakeAmount, setStakeAmount] = useState('');
  const [fees, setFees] = useState({ platformFee: 10, boostJackpotFee: 5 });
  const [goldenRanges, setGoldenRanges] = useState([]);
  const [boostStats, setBoostStats] = useState(null);
  const { showNotification } = useNotification();
  useWallet();

  const jackpotFeePct = fees.boostJackpotFee ?? fees.freeJackpotFee ?? 0;
  const platformFeePct = fees.platformFee ?? 10;

  const fetchBoostStats = useCallback(async () => {
    const itemId = item?._id;
    if (!itemId) return;
    try {
      const path = isPoll
        ? `/predictions/poll/${itemId}/boost-stats`
        : `/predictions/match/${itemId}/boost-stats`;
      const { data } = await api.get(path);
      setBoostStats(data);
    } catch (error) {
      console.warn('boost-stats', error?.message || error);
    }
  }, [item?._id, isPoll]);

  useEffect(() => {
    const load = async () => {
      try {
        const [feesRes, balRes] = await Promise.all([
          api.get('/superadmin/get-fees'),
          api.get('/tickets/balances'),
        ]);
        setFees(feesRes.data || { platformFee: 10, boostJackpotFee: 5 });
        setGoldenRanges(balRes.data?.goldenTicketBoostRanges || []);
      } catch (error) {
        console.error('Error loading boost helpers:', error);
      }
    };
    load();
    fetchBoostStats();
  }, [fetchBoostStats, item?.boostPool]);

  const goldenTicketsForStake = (stakeUsdc) => {
    const amt = Number(stakeUsdc) || 0;
    if (amt <= 0 || !goldenRanges.length) return 0;
    for (const r of goldenRanges) {
      const min = Number(r.minUsdc) || 0;
      const max = Number(r.maxUsdc) || Infinity;
      const tickets = parseInt(r.tickets, 10) || 0;
      if (amt >= min && amt <= max) return tickets;
    }
    return 0;
  };

  const effectiveBoostPool =
    item.isResolved && (item.originalBoostPool ?? 0) > 0
      ? item.originalBoostPool
      : boostStats?.boostPool ?? item.boostPool ?? 0;

  const estimateNetStake = (gross) => {
    const g = Number(gross) || 0;
    const platformFee = (g * platformFeePct) / 100;
    const jpFee = (g * jackpotFeePct) / 100;
    return Math.max(0, g - platformFee - jpFee);
  };

  const stakeOnOutcome = (outcomeLabel) => {
    const key = boostOutcomeStatsKey(outcomeLabel, item, isPoll);
    return Number(boostStats?.stakesByOutcome?.[key]) || 0;
  };

  const boostPotentialWin = (grossUsdc, existingNetStake = 0, outcomeLabel = null) => {
    const outcome =
      outcomeLabel ??
      (prediction ? prediction.outcome : selectedOutcome);
    const outcomeTotal = stakeOnOutcome(outcome);
    const netNew = estimateNetStake(grossUsdc);
    return estimateBoostPotentialWin({
      grossStakeUsdc: grossUsdc,
      boostPoolUsdc: effectiveBoostPool,
      existingNetStake,
      winningOutcomeTotalStake:
        Number(grossUsdc) > 0 ? outcomeTotal + netNew : outcomeTotal,
      platformFeePct,
      jackpotFeePct,
    });
  };
  
  const isResolved = item.isResolved;
  // Map result to display name: TeamA -> teamA name, TeamB -> teamB name, Draw -> Draw
  const getDisplayResult = () => {
    if (!item.result) return '';
    const result = item.result.trim();
    if (result === 'TeamA' || result.toLowerCase() === 'teama') {
      return item.teamA || 'Team A';
    } else if (result === 'TeamB' || result.toLowerCase() === 'teamb') {
      return item.teamB || 'Team B';
    } else if (result === 'Draw' || result.toLowerCase() === 'draw') {
      return 'Draw';
    }
    // If result is already a team name, return it as is
    return result;
  };
  const resolvedOutcome = getDisplayResult();
  // Check if won: status is 'won' OR (status is 'settled' and payout > 0) OR (payout > 0 and status is not 'lost')
  const hasWon = prediction && (
    prediction.status === 'won' || 
    (prediction.status === 'settled' && (prediction.payout || 0) > 0) ||
    ((prediction.payout || 0) > 0 && prediction.status !== 'lost')
  );
  // const canModify = !locked && !isResolved && (item.status === 'upcoming' || item.status === 'active');
  
  const getOutcomeOptions = () => {
    if (isPoll) {
      if (item.optionType === 'options' && item.options) {
        return item.options.map(opt => ({ text: opt.text, image: opt.image }));
      }
      return ['YES', 'NO'];
    }
    const rows = [
      { text: item.teamA, image: item.teamAImage },
      ...(item.drawEnabled !== false ? [{ text: 'Draw', image: 'draw-icon' }] : []),
      { text: item.teamB, image: item.teamBImage },
    ];
    return rows;
  };

  const handleBack = () => {
    if (item.cup && item.cup.slug) {
      navigate(`/cup/${item.cup.slug}`);
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8">
          {/* Back Button and Status Tags */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={handleBack}
              className="flex items-center text-gray-600 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="font-medium">Back to Cup</span>
            </button>
            <div className="flex items-center gap-2">
              {/* Status Tag */}
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                isPoll 
                  ? (item.status === 'upcoming' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                     item.status === 'active' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                     item.status === 'locked' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                     'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200')
                  : (item.status === 'upcoming' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                     item.status === 'live' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                     item.status === 'locked' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                     'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200')
              }`}>
                {item.status?.toUpperCase() || 'N/A'}
              </span>
              {/* Resolved Tag */}
              {item.isResolved && (
                <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
                  RESOLVED
                </span>
              )}
            </div>
          </div>
          {/* Header with Images */}
          {!isPoll && (
            <div className="flex items-center justify-center gap-8 mb-6">
              <div className="flex flex-col items-center">
                {item.teamAImage && (
                  <img src={item.teamAImage} alt={item.teamA} className="w-24 h-24 object-cover rounded-full mb-2 border-4 border-gray-200 dark:border-gray-700" />
                )}
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{item.teamA}</h2>
              </div>
              <div className="text-2xl font-bold text-gray-500 dark:text-gray-400">VS</div>
              <div className="flex flex-col items-center">
                {item.teamBImage && (
                  <img src={item.teamBImage} alt={item.teamB} className="w-24 h-24 object-cover rounded-full mb-2 border-4 border-gray-200 dark:border-gray-700" />
                )}
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{item.teamB}</h2>
              </div>
            </div>
          )}
          {isPoll ? (
            <div className="flex items-start gap-4 mb-6">
              {item.thumbnailImage ? (
                <img
                  src={item.thumbnailImage}
                  alt={item.question}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700 flex-shrink-0"
                />
              ) : null}
              <div className="min-w-0">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 text-left break-words">
                  {item.question}
                </h1>
                <p className="text-gray-600 dark:text-gray-400 text-left break-words">
                  {item.description}
                </p>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 text-center">
                {`${item.teamA} vs ${item.teamB}`}
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-6 text-center">
                {`${new Date(item.date).toLocaleDateString()} • ${item.stageName || ''}`}
              </p>
            </>
          )}

          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800 mb-6">
            <div className="text-sm text-green-600 dark:text-green-400 font-semibold mb-1">Jackpot pool</div>
            <div className="text-xl font-bold text-green-700 dark:text-green-300">
              {formatUsdAmount(
                item.isResolved && item.originalFreeJackpotPool
                  ? item.originalFreeJackpotPool
                  : item.freeJackpotPool || 0
              )}
            </div>
            <p className="text-xs text-green-700/80 dark:text-green-300/80 mt-1">
              Boost pool (this match): {formatUsdAmount(effectiveBoostPool)}
            </p>
          </div>

          {isResolved && (
            <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Resolved Outcome
              </h2>
              <p className="text-lg text-gray-900 dark:text-white">
                Result: <strong>{resolvedOutcome}</strong>
              </p>
            </div>
          )}

          <div className="bg-purple-50 dark:bg-purple-900 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              BOOST Prize Pool Contest
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-2">
              Stake USDC to enter the prize pool. Winners split the pool proportionally.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {platformFeePct}% platform fee • {jackpotFeePct}% to free jackpot pool • Game locks at kickoff
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Prize pool: {formatUsdAmount(effectiveBoostPool)}
              {(boostStats?.adminTopUp ?? 0) > 0.001 && (
                <span> (includes {formatUsdAmount(boostStats.adminTopUp)} sponsor top-up)</span>
              )}
            </p>
            {goldenRanges.length > 0 && (
              <div className="mt-3 text-xs text-amber-800 dark:text-amber-200 bg-amber-50/80 dark:bg-amber-950/40 rounded-lg p-3 border border-amber-200/60 dark:border-amber-800">
                <div className="font-semibold mb-1">Golden ticket ranges (per stake)</div>
                <ul className="space-y-0.5">
                  {goldenRanges.map((r, i) => (
                    <li key={i} className="tabular-nums">
                      {formatUsdAmount(r.minUsdc)} – {r.maxUsdc != null ? formatUsdAmount(r.maxUsdc) : '∞'} → +{r.tickets || 0} ⭐
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {prediction ? (
            <div className={`rounded-lg p-6 mb-6 ${hasWon ? 'bg-green-50 dark:bg-green-900' : 'bg-gray-50 dark:bg-gray-700'}`}>
              <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                Your Prediction:{' '}
                {!isPoll
                  ? (() => {
                      const outcome = String(prediction.outcome || '').trim();
                      if (outcome === 'TeamA' || outcome.toLowerCase() === 'teama') {
                        return item.teamA || 'Team A';
                      }
                      if (outcome === 'TeamB' || outcome.toLowerCase() === 'teamb') {
                        return item.teamB || 'Team B';
                      }
                      if (outcome === 'Draw' || outcome.toLowerCase() === 'draw') {
                        return 'Draw';
                      }
                      return outcome;
                    })()
                  : prediction.outcome}
              </p>
              {(() => {
                const stakedEth =
                  isResolved && !hasWon && prediction.originalStake
                    ? prediction.originalStake
                    : (prediction.totalStake || prediction.amount || 0);
                const netStake = Number(stakedEth) || 0;
                const potWin =
                  !isResolved && netStake > 0
                    ? boostPotentialWin(0, netStake, prediction.outcome)
                    : null;
                return (
                  <div className="mb-2 space-y-1">
                    <p className="text-gray-600 dark:text-gray-400">
                      Staked Amount: {formatUsdAmount(netStake)}
                    </p>
                    {potWin != null && Number.isFinite(potWin) && (
                      <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                        Potential win if correct: {formatUsdAmount(potWin)}
                      </p>
                    )}
                  </div>
                );
              })()}
              {isResolved && (
                <>
                  <p className={`text-lg mb-2 ${hasWon ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                    Status: {hasWon ? '✅ Won' : '❌ Lost'}
                  </p>
                  {hasWon ? (
                    prediction.claimed ? (
                      <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                        <p className="text-sm text-gray-600 dark:text-gray-400">Reward claimed</p>
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                          Payout: {formatUsdAmount(prediction.payout || 0)}
                        </p>
                      </div>
                    ) : (
                      <div className="mt-4">
                        <div className="mb-2">
                          <p className="text-gray-600 dark:text-gray-400">
                            Your Win: {formatUsdAmount(prediction.payout || 0)}
                          </p>
                        </div>
                        <button
                          onClick={async () => {
                            try {
                              if (!item || !item.marketId) {
                                showNotification('Market not found', 'error');
                                return;
                              }
                              if (!walletAddress) {
                                showNotification('Connect your wallet (same as on your profile)', 'warning');
                                return;
                              }

                              const { data: auth } = await api.post(`/predictions/${prediction._id}/claim-authorization`, {
                                walletAddress,
                              });

                              // Gas-drip before claim if user has no Base ETH for gas.
                              const okGas = await ensureGasOrDrip(walletAddress, { label: 'claim' });
                              if (!okGas) return;

                              const txHash =
                                auth.claimKind === 'orderbook'
                                  ? await claimOrderbookPositionWithAuth(
                                      auth.marketId,
                                      auth.amountWei,
                                      auth.positionKey,
                                      auth.predictionId,
                                      auth.deadline,
                                      auth.signature
                                    )
                                  : await claimPredictionWinsWithAuth(
                                      auth.marketId,
                                      auth.isBoost,
                                      auth.amountWei,
                                      auth.predictionId,
                                      auth.deadline,
                                      auth.signature
                                    );
                              showNotification(`Claim sent to blockchain! TX: ${txHash.slice(0, 10)}...`, 'success');

                              try {
                                await api.post('/transactions', {
                                  action: auth.claimKind === 'boost' ? 'boost_claim' : 'market_claim',
                                  txHash,
                                  amount: parseFloat(unitsToUsdc(auth.amountWei)),
                                  currency: 'USDC',
                                  itemType: isPoll ? 'poll' : 'match',
                                  itemId: item._id,
                                  meta: { predictionId: String(prediction._id) },
                                });
                              } catch {
                                // ignore
                              }

                              await api.post(`/predictions/${prediction._id}/claim`);
                              showNotification('Payout claimed successfully!', 'success');

                              if (onRefreshPrediction) {
                                await onRefreshPrediction();
                              } else {
                                window.location.reload();
                              }
                            } catch (error) {
                              console.error('Error claiming:', error);
                              const msg =
                                error?.response?.data?.message ||
                                getBlockchainErrorMessage(error) ||
                                error.message ||
                                'Failed to claim';
                              showNotification(msg, 'error');
                            }
                          }}
                          disabled={prediction.claimed}
                          className={`px-6 py-2 rounded-lg transition-colors ${
                            prediction.claimed
                              ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                              : 'bg-green-500 text-white hover:bg-green-600'
                          }`}
                        >
                          {prediction.claimed ? 'Reward Claimed' : 'Claim Rewards'}
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="mt-4 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                      <p className="text-sm text-gray-600 dark:text-gray-400">You did not win this prediction</p>
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                        Your stake was moved to the winning option
                      </p>
                    </div>
                  )}
                </>
              )}
              {/* {canModify && !isResolved && (
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    onClick={() => {
                      if (!locked) {
                        setSelectedOutcome(prediction.outcome);
                        setShowPredictModal(true);
                      }
                    }}
                    disabled={locked}
                    className={`px-4 py-2 rounded-lg transition-colors ${
                      locked
                        ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                  >
                    Update Prediction
                  </button>
                  <button
                    onClick={() => {
                      if (!locked) {
                        setStakeAction('add');
                        setShowStakeModal(true);
                      }
                    }}
                    disabled={locked}
                    className={`px-4 py-2 rounded-lg transition-colors ${
                      locked
                        ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                        : 'bg-green-500 text-white hover:bg-green-600'
                    }`}
                  >
                    Add Stake
                  </button>
                  <button
                    onClick={() => {
                      if (!locked) {
                        setStakeAction('withdraw');
                        setShowStakeModal(true);
                      }
                    }}
                    disabled={locked}
                    className={`px-4 py-2 rounded-lg transition-colors ${
                      locked
                        ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                        : 'bg-orange-500 text-white hover:bg-orange-600'
                    }`}
                  >
                    Withdraw Stake
                  </button>
                </div>
              )} */}
              {locked && !isResolved && (
                <p className="mt-4 px-4 py-2 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded-lg">
                  Predictions are locked for this match/poll
                </p>
              )}
            </div>
          ) : !isResolved ? (
            <div className="space-y-4">
              {getOutcomeOptions().map((option) => {
                const optionText = typeof option === 'string' ? option : option.text;
                const optionImage = typeof option === 'object' ? option.image : null;
                return (
                  <button
                    key={optionText}
                    type="button"
                    onClick={() => {
                      setSelectedOutcome(optionText);
                      setShowPredictModal(true);
                    }}
                    className="flex w-full items-center justify-center gap-3 rounded-lg bg-gray-100 px-6 py-4 text-lg font-semibold text-gray-900 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
                  >
                    <OutcomeOptionAvatar image={optionImage} label={optionText} sizeClass="w-12 h-12" />
                    <span>
                      {optionText} {isPoll ? '' : 'Wins'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-6">
              <p className="text-gray-600 dark:text-gray-400">This {isPoll ? 'poll' : 'match'} has been resolved. Predictions are closed.</p>
            </div>
          )}

          {showPredictModal && (
            <Modal isOpen={true} onClose={() => setShowPredictModal(false)} title={prediction ? "Update Boost Prediction" : "Enter Boost Prediction"}>
              <div className="space-y-4">
                {prediction && (
                  <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-4 mb-4">
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      <strong>Current Stake:</strong> {(prediction.totalStake || prediction.amount || 0).toFixed(4)} USDC
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Your stake amount will be automatically preserved when you update the outcome.
                    </p>
                  </div>
                )}
                <p className="text-gray-700 dark:text-gray-300 mb-4">
                  {prediction ? "Select a new outcome:" : "Select your prediction:"}
                </p>
                <div className="space-y-2">
                  {getOutcomeOptions().map((option, index) => {
                    const optionText = typeof option === 'string' ? option : option.text;
                    const optionImage = typeof option === 'object' ? option.image : null;
                    return (
                      <button
                        key={optionText}
                        onClick={() => {
                          if (!locked) {
                            setSelectedOutcome(optionText);
                          }
                        }}
                        disabled={locked}
                        className={`w-full px-4 py-3 rounded-lg font-semibold transition-colors flex items-center justify-center gap-3 ${
                          locked
                            ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                            : selectedOutcome === optionText
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        {optionImage === 'draw-icon' ? (
                          <DrawOutcomeAvatar className="w-8 h-8" />
                        ) : optionImage ? (
                          <img src={optionImage} alt={optionText} className="w-8 h-8 object-cover rounded-full" />
                        ) : null}
                        <span>{optionText} {isPoll ? '' : 'Wins'}</span>
                      </button>
                    );
                  })}
                </div>
                {!prediction && selectedOutcome && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    USDC Amount
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="USDC Amount"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                      required
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {formatUsdAmount(amount || 0)}
                    </p>
                    {amount && parseFloat(amount) > 0 && (
                      <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800 text-xs space-y-1">
                        <p className="text-gray-700 dark:text-gray-300">
                          Net stake after fees: <strong>{formatUsdAmount(estimateNetStake(amount))}</strong>
                        </p>
                        <p className="text-emerald-800 dark:text-emerald-200 font-semibold text-sm">
                          Potential win if correct:{' '}
                          <strong>{formatUsdAmount(boostPotentialWin(amount, 0, selectedOutcome) || 0)}</strong>
                        </p>
                        <p className="text-amber-800 dark:text-amber-200">
                          Golden tickets earned: <strong>+{goldenTicketsForStake(amount)} ⭐</strong>
                        </p>
                        <p className="text-gray-600 dark:text-gray-400">
                          Share of boost pool ({formatUsdAmount(effectiveBoostPool)}) if your pick wins.
                        </p>
                        <p className="text-gray-500 dark:text-gray-500">
                          Fees on stake: {platformFeePct}% platform • {jackpotFeePct}% free jackpot
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  <p>{platformFeePct}% platform fee • {jackpotFeePct}% to free jackpot pool</p>
                  <p>Game locks at kickoff</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      if (!locked) {
                        if (prediction && selectedOutcome) {
                          // Update existing prediction - amount is automatically preserved
                          onPredict(selectedOutcome);
                          setShowPredictModal(false);
                        } else if (selectedOutcome && amount) {
                          // Create new prediction
                          onPredict(selectedOutcome, amount);
                          setShowPredictModal(false);
                          setAmount('');
                        }
                      }
                    }}
                    disabled={locked || !selectedOutcome || (!prediction && !amount)}
                    className={`flex-1 px-4 py-2 rounded-lg ${
                      locked
                        ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {prediction ? 'Update' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => {
                      setShowPredictModal(false);
                      setAmount('');
                      setSelectedOutcome(null);
                    }}
                    className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Modal>
          )}

          {showStakeModal && prediction && (
            <Modal isOpen={true} onClose={() => setShowStakeModal(false)} title={stakeAction === 'add' ? 'Add Stake' : 'Withdraw Stake'}>
              <div className="space-y-4">
                <p className="text-gray-700 dark:text-gray-300">
                  Current Stake: <strong>{(prediction.totalStake || prediction.amount || 0).toFixed(4)} USDC</strong>
                </p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {stakeAction === 'add' ? 'Amount to Add' : 'Amount to Withdraw'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder={`USDC Amount (Max: ${stakeAction === 'withdraw' ? (prediction.totalStake || prediction.amount || 0).toFixed(4) : 'unlimited'})`}
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                    required
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {formatUsdAmount(stakeAmount || 0)}
                  </p>
                </div>
                {stakeAction === 'withdraw' && (
                  <button
                    onClick={() => {
                      const maxAmount = (prediction.totalStake || prediction.amount || 0).toFixed(4);
                      setStakeAmount(maxAmount);
                    }}
                    className="w-full px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    Max
                  </button>
                )}
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      if (!locked && stakeAmount) {
                        onStakeAction(prediction._id, stakeAction, stakeAmount);
                        setShowStakeModal(false);
                        setStakeAmount('');
                      }
                    }}
                    disabled={locked}
                    className={`flex-1 px-4 py-2 rounded-lg ${
                      locked
                        ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                        : stakeAction === 'add' 
                        ? 'bg-green-500 text-white hover:bg-green-600' 
                        : 'bg-orange-500 text-white hover:bg-orange-600'
                    }`}
                  >
                    {stakeAction === 'add' ? 'Add' : 'Withdraw'}
                  </button>
                  <button
                    onClick={() => {
                      setShowStakeModal(false);
                      setStakeAmount('');
                    }}
                    className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Modal>
          )}
        </div>
      </div>
    </div>
  );
};

/** Sum resting bid+ask notional (price × size) for visible depth — shown as book liquidity on the market row. */
function restingBookDepthUsdc(book, maxLevels = 16) {
  if (!book) return 0;
  let sum = 0;
  for (const r of (book.bids || []).slice(0, maxLevels)) {
    sum += Number(r.limitPrice || 0) * Number(r.sizeRemaining || 0);
  }
  for (const r of (book.asks || []).slice(0, maxLevels)) {
    sum += Number(r.limitPrice || 0) * Number(r.sizeRemaining || 0);
  }
  return sum;
}

/** Stable string for order rows — skip React updates when book unchanged (reduces UI thrash). */
function fingerprintSideBook(book) {
  const norm = (rows) =>
    (rows || [])
      .map((r) => `${String(r._id || '')}:${Number(r.limitPrice)}:${Number(r.sizeRemaining)}`)
      .join(',');
  if (!book) return '||';
  return `${norm(book.bids)}|${norm(book.asks)}`;
}

function fingerprintBooksPair(pair) {
  if (!pair) return '##';
  return `${fingerprintSideBook(pair.YES)}#${fingerprintSideBook(pair.NO)}`;
}

const MarketMatchView = ({ item, isPoll, navigate, user, showNotification, locked = false, onItemUpdate, ensureLinkedWallet }) => {
  // USDC ~ USD; no ETH conversion hints
  const { account } = useWallet();
  const [selectedOption, setSelectedOption] = useState(null);
  const [selectedSide, setSelectedSide] = useState('YES'); // YES / NO for the selected outcome
  const [expandedOption, setExpandedOption] = useState(null); // which outcome row is expanded (orderbook dropdown)
  const [booksByOption, setBooksByOption] = useState({}); // { [optionKey]: { YES: {bids,asks}, NO: {bids,asks} } }
  const [tradeType, setTradeType] = useState('buy');
  const [amount, setAmount] = useState('');
  const [, setTrades] = useState([]);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [chartRange, setChartRange] = useState('1D'); // 1H,6H,1D,1W,1M,ALL,CUSTOM
  const [customRangeFrom, setCustomRangeFrom] = useState('');
  const [customRangeTo, setCustomRangeTo] = useState('');
  const [chartData, setChartData] = useState([]);
  const chartHistoryRef = useRef([]);
  const lastChartPointSigRef = useRef('');
  const cloneChartPoint = useCallback((p) => ({ ...p }), []);
  const positionsEverLoadedRef = useRef(false);
  const ordersEverLoadedRef = useRef(false);
  const tradingPanelFetchGenRef = useRef(0);
  const [predictions, setPredictions] = useState({}); // Map of outcome -> prediction
  const [orderbookPositions, setOrderbookPositions] = useState([]);
  const [orderbookPositionsLoading, setOrderbookPositionsLoading] = useState(false);
  const [settlingOrders, setSettlingOrders] = useState([]);
  const [, setRestingLiquidityOrders] = useState([]);
  const [prices, setPrices] = useState({});
  const [priceAmounts, setPriceAmounts] = useState({}); // ETH amounts for each option
  const [currentItem, setCurrentItem] = useState(item);

  // Computed value for itemData - always use currentItem if available, fallback to item
  const itemData = currentItem || item;
  
  // Check if resolved
  const isResolved = itemData.isResolved || itemData.status === 'settled' || itemData.status === 'completed';
  // Map result to display name: TeamA -> teamA name, TeamB -> teamB name, Draw -> Draw
  const getDisplayResult = () => {
    if (!itemData.result) return '';
    const result = itemData.result.trim();
    if (result === 'TeamA' || result.toLowerCase() === 'teama') {
      return itemData.teamA || 'Team A';
    } else if (result === 'TeamB' || result.toLowerCase() === 'teamb') {
      return itemData.teamB || 'Team B';
    } else if (result === 'Draw' || result.toLowerCase() === 'draw') {
      return 'Draw';
    }
    // If result is already a team name, return it as is
    return result;
  };
  const resolvedOutcome = getDisplayResult();
  
  // Helper function to map outcome to display name (for claim buttons)
  const getDisplayOutcome = (outcome) => {
    if (!outcome) return '';
    return formatMarketOrderbookOutcomeLabel(outcome.trim(), itemData, isPoll);
  };
  
  // Calculate winning predictions
  const winningPredictions = Object.values(predictions).filter(pred => 
    pred.status === 'won' || pred.status === 'settled'
  );
  const hasWon = winningPredictions.length > 0;

  const outcomeRows = useMemo(() => {
    return (isPoll
      ? (itemData.options || []).map((o) => ({
          key: String(o.text || '').trim(),
          label: o.text,
          image: o.image || null,
        }))
      : [
          { key: 'TeamA', label: itemData.teamA || 'Team A', image: itemData.teamAImage || null },
          ...(itemData.drawEnabled !== false
            ? [{ key: 'Draw', label: 'Draw', image: 'draw-icon' }]
            : []),
          { key: 'TeamB', label: itemData.teamB || 'Team B', image: itemData.teamBImage || null },
        ]
    ).filter((o) => o.key);
  }, [
    isPoll,
    itemData.options,
    itemData.teamA,
    itemData.teamB,
    itemData.teamAImage,
    itemData.teamBImage,
    itemData.drawEnabled,
  ]);

  const fetchAllOptionBooks = useCallback(
    async (opts = {}) => {
      const force = opts.force === true;
      const chainMarketId = itemData?.marketId;
      if (!chainMarketId || !outcomeRows.length) return;
      try {
        const results = await Promise.all(
          outcomeRows.map(async (row) => {
            const key = row.key;
            try {
              const [yesRes, noRes] = await Promise.all([
                api.get(`/orderbook/book/${chainMarketId}`, { params: { optionKey: key, side: 'YES' } }),
                api.get(`/orderbook/book/${chainMarketId}`, { params: { optionKey: key, side: 'NO' } }),
              ]);
              return [
                key,
                {
                  YES: yesRes.data || { bids: [], asks: [] },
                  NO: noRes.data || { bids: [], asks: [] },
                },
              ];
            } catch {
              return [key, { YES: { bids: [], asks: [] }, NO: { bids: [], asks: [] } }];
            }
          })
        );
        setBooksByOption((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [k, v] of results) {
            const fp = fingerprintBooksPair(v);
            if (!force && fingerprintBooksPair(prev[k]) === fp) continue;
            next[k] = v;
            changed = true;
          }
          return changed ? next : prev;
        });
      } catch {
        // ignore
      }
    },
    [itemData?.marketId, outcomeRows]
  );

  const orderbookOptionLabelByKey = useMemo(() => new Map(outcomeRows.map((o) => [o.key, o.label])), [outcomeRows]);

  useEffect(() => {
    if (selectedOption) return;
    const first = outcomeRows[0]?.key;
    if (first) setSelectedOption(first);
  }, [outcomeRows, selectedOption]);

  const clearTradingPanelState = useCallback(() => {
    setOrderbookPositions([]);
    setMyOrders([]);
    setSettlingOrders([]);
    setRestingLiquidityOrders([]);
    positionsEverLoadedRef.current = false;
    ordersEverLoadedRef.current = false;
  }, []);

  const fetchTradingPanel = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    const force = opts.force === true;
    const requestUserId = user?._id != null ? String(user._id) : null;
    const requestMarketId = itemData?.marketId;

    if (!requestUserId || requestMarketId == null) {
      clearTradingPanelState();
      setOrderbookPositionsLoading(false);
      setMyOrdersLoading(false);
      return;
    }

    const fetchGen = ++tradingPanelFetchGenRef.current;
    const showPositionsLoading = !silent && !positionsEverLoadedRef.current;
    const showOrdersLoading = !silent && !ordersEverLoadedRef.current;
    if (showPositionsLoading) setOrderbookPositionsLoading(true);
    if (showOrdersLoading) setMyOrdersLoading(true);
    try {
      const { data } = await api.get('/orderbook/trading-panel/mine', {
        params: { chainMarketId: requestMarketId },
      });

      if (fetchGen !== tradingPanelFetchGenRef.current) return;
      if (data?.userId != null && String(data.userId) !== requestUserId) return;

      const rows = Array.isArray(data?.positions) ? data.positions : [];
      const working = Array.isArray(data?.workingOrders) ? data.workingOrders : [];
      const posSig = rows.map((r) => `${r.positionKey}:${r.shares}:${r.totalInvested}`).join(';');
      const ordSig = working
        .map(
          (o) =>
            `${o._id}:${o.status}:${o.sizeRemaining}:${o.sizeFilled}:${o.limitPrice}:${o.updatedAt || o.createdAt}`
        )
        .join(';');
      setOrderbookPositions((prev) => {
        if (!force) {
          const prevSig = prev.map((r) => `${r.positionKey}:${r.shares}:${r.totalInvested}`).join(';');
          if (prevSig === posSig) return prev;
        }
        return rows;
      });
      setMyOrders((prev) => {
        if (!force) {
          const prevSig = prev
            .map(
              (o) =>
                `${o._id}:${o.status}:${o.sizeRemaining}:${o.sizeFilled}:${o.limitPrice}:${o.updatedAt || o.createdAt}`
            )
            .join(';');
          if (prevSig === ordSig) return prev;
        }
        return working;
      });
      setSettlingOrders(Array.isArray(data?.settlingOrders) ? data.settlingOrders : []);
      setRestingLiquidityOrders(Array.isArray(data?.restingLiquidityOrders) ? data.restingLiquidityOrders : []);
    } catch (e) {
      if (fetchGen !== tradingPanelFetchGenRef.current) return;
      clearTradingPanelState();
    } finally {
      if (fetchGen !== tradingPanelFetchGenRef.current) return;
      positionsEverLoadedRef.current = true;
      ordersEverLoadedRef.current = true;
      if (showPositionsLoading) setOrderbookPositionsLoading(false);
      setMyOrdersLoading(false);
    }
  }, [user?._id, itemData?.marketId, clearTradingPanelState]);

  const fetchOrderbookPositions = fetchTradingPanel;

  useEffect(() => {
    fetchTradingPanel();
  }, [fetchTradingPanel]);

  useEffect(() => {
    clearTradingPanelState();
  }, [user?._id, itemData?.marketId, clearTradingPanelState]);

  const holdingsByOutcome = useMemo(() => {
    const map = {};
    for (const o of outcomeRows) {
      map[o.key] = { optionKey: o.key, label: o.label, YES: null, NO: null };
    }
    for (const pos of orderbookPositions || []) {
      const [opt, s] = String(pos.positionKey || '').split('|');
      const side = String(s || '').toUpperCase();
      if (!opt || (side !== 'YES' && side !== 'NO')) continue;
      if (!map[opt]) map[opt] = { optionKey: opt, label: opt, YES: null, NO: null };
      map[opt][side] = {
        shares: Number(pos.shares || 0),
        totalInvested: Number(pos.totalInvested || 0),
      };
    }
    return Object.values(map);
  }, [orderbookPositions, outcomeRows]);

  const holdingsWithShares = useMemo(
    () =>
      holdingsByOutcome.filter(
        (row) => (row.YES?.shares || 0) > 1e-9 || (row.NO?.shares || 0) > 1e-9
      ),
    [holdingsByOutcome]
  );

  const bookMidPrice = useCallback((opt, side) => {
    const b = booksByOption?.[opt]?.[side];
    const bestBid = b?.bids?.length ? Number(b.bids[0].limitPrice) : null;
    const bestAsk = b?.asks?.length ? Number(b.asks[0].limitPrice) : null;
    if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
    if (bestAsk != null) return bestAsk;
    if (bestBid != null) return bestBid;
    return null;
  }, [booksByOption]);

  const outcomeImpliedRaw = useMemo(() => {
    const raw = {};
    const n = Math.max(1, outcomeRows.length);
    for (const row of outcomeRows) {
      const yesMid = bookMidPrice(row.key, 'YES');
      const noMid = bookMidPrice(row.key, 'NO');
      let p = yesMid;
      if (p == null && noMid != null) p = 1 - noMid;
      if (p == null) {
        const sp = (itemData.startingPrices || []).find(
          (r) => String(r.optionKey) === String(row.key)
        );
        const yp = Number(sp?.yesPrice);
        if (Number.isFinite(yp) && yp > 0 && yp < 1) p = yp;
      }
      raw[row.key] = Math.max(0.001, Math.min(0.999, p ?? 1 / n));
    }
    return raw;
  }, [outcomeRows, bookMidPrice, itemData.startingPrices]);

  const outcomeImpliedPrices = useMemo(() => {
    const sum = Object.values(outcomeImpliedRaw).reduce((a, b) => a + b, 0) || 1;
    const out = {};
    for (const [k, v] of Object.entries(outcomeImpliedRaw)) out[k] = v / sum;
    return out;
  }, [outcomeImpliedRaw]);

  const rankedOutcomeRows = useMemo(() => {
    return [...outcomeRows]
      .map((row) => ({
        ...row,
        volumePct: (outcomeImpliedPrices[row.key] ?? 0) * 100,
      }))
      .sort((a, b) => b.volumePct - a.volumePct);
  }, [outcomeRows, outcomeImpliedPrices]);

  const orderbookHoldingsTotal = useMemo(() => {
    if (isResolved) {
      // Use backend payout amounts for winners (already computed accurately)
      return Object.values(predictions).reduce((sum, pred) => {
        if (!pred || pred.claimed) return sum;
        const p = Number(pred.payout);
        return sum + (Number.isFinite(p) && p > 0 ? p : 0);
      }, 0);
    }
    let total = 0;
    for (const row of holdingsByOutcome) {
      for (const side of ['YES', 'NO']) {
        const p = row?.[side];
        if (!p || !(p.shares > 0)) continue;
        const mid = bookMidPrice(row.optionKey, side);
        if (mid == null) continue;
        total += p.shares * mid;
      }
    }
    return total;
  }, [holdingsByOutcome, bookMidPrice, isResolved, predictions]);

  /** Net USDC profit if each held side wins ($1/share payout minus cost). */
  const orderbookHoldingsPotentialWinTotal = useMemo(() => {
    if (isResolved) return 0;
    let total = 0;
    for (const pos of orderbookPositions || []) {
      const shares = Number(pos.shares || 0);
      const invested = Number(pos.totalInvested || 0);
      if (shares > 1e-9) total += Math.max(0, shares - invested);
    }
    return total;
  }, [orderbookPositions, isResolved]);

  const redeemableByPositionKey = useMemo(() => {
    const map = {};
    for (const pred of Object.values(predictions)) {
      if (!pred || pred.claimed) continue;
      const k = String(pred.outcome || '').trim();
      if (!k) continue;
      const p = Number(pred.payout);
      map[k] = Number.isFinite(p) && p > 0 ? p : 0;
    }
    return map;
  }, [predictions]);

  const [myOrders, setMyOrders] = useState([]);
  const [myOrdersLoading, setMyOrdersLoading] = useState(false);
  const [vaultRefreshNonce, setVaultRefreshNonce] = useState(0);
  const bumpVaultRefresh = useCallback(() => setVaultRefreshNonce((n) => n + 1), []);
  const [closingPositionKey, setClosingPositionKey] = useState(null);
  const [cancelingOrderId, setCancelingOrderId] = useState(null);
  const [cancelingAllOrders, setCancelingAllOrders] = useState(false);
  const [closingAllPositions, setClosingAllPositions] = useState(false);
  const [ordersPage, setOrdersPage] = useState(1);
  const [positionsPage, setPositionsPage] = useState(1);
  const [settlingPage, setSettlingPage] = useState(1);
  const marketTablePageSize = 5;
  const lastMarketPollSig = useRef('');

  useEffect(() => {
    lastMarketPollSig.current = '';
    chartHistoryRef.current = [];
    lastChartPointSigRef.current = '';
    positionsEverLoadedRef.current = false;
    ordersEverLoadedRef.current = false;
    setSettlingPage(1);
    setOrdersPage(1);
    setPositionsPage(1);
  }, [itemData?._id]);

  const fetchMyOrders = fetchTradingPanel;

  const cancelOrderbookOrder = useCallback(
    async (orderId) => {
      const id = orderId != null ? encodeURIComponent(String(orderId)) : '';
      if (!id) {
        showNotification('Invalid order id', 'error');
        return;
      }
      try {
        await api.delete(`/orderbook/orders/${id}`);
        showNotification('Order cancelled', 'success');
        bumpVaultRefresh();
        await fetchMyOrders({ force: true });
      } catch (e) {
        showNotification(e?.response?.data?.message || e?.message || 'Cancel failed', 'error');
      }
    },
    [showNotification, bumpVaultRefresh, fetchMyOrders]
  );

  const closeOrderbookPosition = useCallback(
    async (positionKey, shares) => {
      if (!user) {
        showNotification('Login to trade', 'warning');
        return;
      }
      if (isResolved) {
        return;
      }
      if (locked) {
        showNotification('Trading is locked for this market', 'warning');
        return;
      }
      const [optionKey, side] = String(positionKey || '').split('|');
      const sz = Number(shares || 0);
      if (!optionKey || (side !== 'YES' && side !== 'NO') || !(sz > 0)) {
        showNotification('Invalid position', 'error');
        return;
      }
      setClosingPositionKey(String(positionKey || ''));
      try {
        const addr = await ensureLinkedWallet();
        const { data: order } = await api.post('/orderbook/orders', {
          walletAddress: addr,
          matchId: !isPoll ? String(itemData._id) : undefined,
          pollId: isPoll ? String(itemData._id) : undefined,
          optionKey,
          side,
          direction: 'sell',
          orderKind: 'market',
          size: sz,
          slippageBps: 150,
        });
        const filled = Number(order?.sizeFilled) || 0;
        const remaining = Number(order?.sizeRemaining) || 0;
        const status = String(order?.status || '').toLowerCase();
        if (filled <= 1e-9) {
          showNotification('No liquidity to close position right now. Try again shortly.', 'error');
          return;
        }
        const fullyClosed = remaining <= 1e-6 && filled + 1e-6 >= sz;
        if (remaining > 1e-6) {
          showNotification(
            `Partially closed: ${filled.toFixed(4)} of ${sz.toFixed(4)} shares sold`,
            'warning'
          );
        } else if (fullyClosed || status === 'filled') {
          showNotification('Position closed at market price', 'success');
        } else {
          showNotification(
            `Sold ${filled.toFixed(4)} shares — refreshing position…`,
            'success'
          );
        }
        bumpVaultRefresh();
        window.setTimeout(bumpVaultRefresh, 5000);
        await Promise.all([
          fetchOrderbookPositions({ force: true }),
          fetchMyOrders({ force: true }),
          fetchAllOptionBooks({ force: true }),
        ]);
        try {
          const itemResponse = isPoll
            ? await api.get(`/polls/${itemData._id}`)
            : await api.get(`/matches/${itemData._id}`);
          setCurrentItem(itemResponse.data);
          if (onItemUpdate) onItemUpdate(itemResponse.data);
        } catch {
          /* pause flags refresh is best-effort */
        }
        if (fullyClosed || status === 'filled') {
          await new Promise((r) => window.setTimeout(r, 400));
          const { data: panel } = await api.get('/orderbook/trading-panel/mine', {
            params: { chainMarketId: itemData.marketId },
          });
          const stillOpen = (panel?.positions || []).some(
            (p) =>
              String(p.positionKey) === String(positionKey) &&
              (Number(p.shares) || 0) > 1e-6
          );
          if (stillOpen) {
            showNotification(
              'Trade filled but position list is updating — please refresh if the row remains.',
              'warning'
            );
          }
          await fetchOrderbookPositions({ force: true });
        }
      } catch (e) {
        showNotification(e?.response?.data?.message || e?.message || 'Failed to close position', 'error');
      } finally {
        setClosingPositionKey(null);
      }
    },
    [
      user,
      isResolved,
      locked,
      ensureLinkedWallet,
      isPoll,
      itemData?._id,
      itemData?.marketId,
      fetchOrderbookPositions,
      fetchMyOrders,
      fetchAllOptionBooks,
      showNotification,
      bumpVaultRefresh,
      onItemUpdate,
    ]
  );

  const positionTableRows = useMemo(() => {
    const rows = [];
    const labelByOptionKey = new Map(outcomeRows.map((o) => [o.key, o.label]));
    for (const pos of orderbookPositions || []) {
      const pk = String(pos.positionKey || '');
      const [optionKey, side] = pk.split('|');
      const shares = Number(pos.shares || 0);
      const invested = Number(pos.totalInvested || 0);
      if (!optionKey || (side !== 'YES' && side !== 'NO') || !(shares > 1e-9)) continue;
      const avg = invested > 0 && shares > 0 ? invested / shares : null;
      const cur = bookMidPrice(optionKey, side);
      const pnl = cur != null && avg != null ? (cur - avg) * shares : null;
      const potentialWin =
        shares > 1e-9
          ? Math.max(
              0,
              invested > 0
                ? shares - invested
                : avg != null
                  ? estimateMarketOrderbookPotentialWin({
                      direction: 'buy',
                      shares,
                      price: avg,
                    }) ?? 0
                  : 0
            )
          : 0;
      rows.push({
        positionKey: pk,
        optionKey,
        optionLabel: labelByOptionKey.get(optionKey) || optionKey,
        side,
        shares,
        avgPrice: avg,
        currentPrice: cur,
        pnl,
        potentialWin,
      });
    }
    return rows;
  }, [orderbookPositions, bookMidPrice, outcomeRows]);

  // Update currentItem when item prop changes
  useEffect(() => {
    setCurrentItem(item);
  }, [item]);

  // Calculate prices and price amounts (ETH) based on liquidity
  useEffect(() => {
    let calculatedPrices = {};
    let calculatedPriceAmounts = {};
    let totalLiquidity = 0;
    
    if (isPoll) {
      // Poll: Handle option-based or Yes/No
      if (itemData.optionType === 'options' && itemData.options && Array.isArray(itemData.options)) {
        totalLiquidity = itemData.options.reduce((sum, opt) => sum + (parseFloat(opt.liquidity) || 0), 0);
        itemData.options.forEach(opt => {
          const optLiquidity = parseFloat(opt.liquidity) || 0;
          const defaultPrice = 1 / itemData.options.length;
          // Round all prices to 4 decimal places
          calculatedPrices[opt.text] = totalLiquidity === 0 
            ? parseFloat(defaultPrice.toFixed(4)) 
            : parseFloat((optLiquidity / totalLiquidity).toFixed(4));
          calculatedPriceAmounts[opt.text] = optLiquidity;
        });
      } else {
        // Normal Yes/No poll
        const yesLiq = parseFloat(itemData.marketYesLiquidity) || 0;
        const noLiq = parseFloat(itemData.marketNoLiquidity) || 0;
        totalLiquidity = yesLiq + noLiq;
        // Round all prices to 4 decimal places
        calculatedPrices.yes = totalLiquidity === 0 
          ? parseFloat((0.5).toFixed(4)) 
          : parseFloat((yesLiq / totalLiquidity).toFixed(4));
        calculatedPrices.no = totalLiquidity === 0 
          ? parseFloat((0.5).toFixed(4)) 
          : parseFloat((noLiq / totalLiquidity).toFixed(4));
        calculatedPriceAmounts.yes = yesLiq;
        calculatedPriceAmounts.no = noLiq;
      }
    } else {
      // Match: TeamA/TeamB/Draw
      // Parse liquidity values to ensure they're numbers
      const teamALiq = parseFloat(itemData.marketTeamALiquidity) || 0;
      const teamBLiq = parseFloat(itemData.marketTeamBLiquidity) || 0;
      const drawLiq =
        itemData.drawEnabled !== false ? parseFloat(itemData.marketDrawLiquidity) || 0 : 0;
      totalLiquidity = teamALiq + teamBLiq + drawLiq;
      const defaultSplit = itemData.drawEnabled !== false ? 3 : 2;
      calculatedPrices.teamA =
        totalLiquidity === 0
          ? parseFloat((1 / defaultSplit).toFixed(4))
          : parseFloat((teamALiq / totalLiquidity).toFixed(4));
      calculatedPrices.teamB =
        totalLiquidity === 0
          ? parseFloat((1 / defaultSplit).toFixed(4))
          : parseFloat((teamBLiq / totalLiquidity).toFixed(4));
      if (itemData.drawEnabled !== false) {
        calculatedPrices.draw =
          totalLiquidity === 0
            ? parseFloat((1 / defaultSplit).toFixed(4))
            : parseFloat((drawLiq / totalLiquidity).toFixed(4));
        calculatedPriceAmounts.draw = drawLiq;
      }
      calculatedPriceAmounts.teamA = teamALiq;
      calculatedPriceAmounts.teamB = teamBLiq;
      
      // Debug logging for matches
      console.log('Match Price Calculation:', {
        teamALiq,
        teamBLiq,
        drawLiq,
        totalLiquidity,
        prices: calculatedPrices,
        priceSum: calculatedPrices.teamA + calculatedPrices.teamB + calculatedPrices.draw
      });
    }
    
    setPrices(calculatedPrices);
    setPriceAmounts(calculatedPriceAmounts);
    
    // Debug: Log price sum to verify it equals 1.0
    const priceSum = Object.values(calculatedPrices).reduce((sum, price) => sum + price, 0);
    if (Math.abs(priceSum - 1.0) > 0.01) {
      console.warn('Prices do not sum to 1.0:', priceSum, calculatedPrices);
    }
  }, [currentItem, item, isPoll, itemData.optionType, itemData.drawEnabled, itemData.marketTeamALiquidity, itemData.marketTeamBLiquidity, itemData.marketDrawLiquidity, itemData.marketYesLiquidity, itemData.marketNoLiquidity, itemData.options]);

  const fetchMarketData = useCallback(async () => {
    try {
      const itemId = (currentItem || item)?._id || item?._id;
      const response = await api.get(`/predictions/market/${itemId}/data?type=${isPoll ? 'poll' : 'match'}`);
      const nextTrades = response.data.recentTrades || [];
      const nextPrices = response.data.prices;
      const sig = JSON.stringify({
        p: nextPrices || null,
        t: (nextTrades || []).slice(0, 40).map((x) => ({
          id: x._id,
          a: x.amount,
          t: x.createdAt,
          o: x.outcome,
        })),
      });
      if (lastMarketPollSig.current === sig) return;
      lastMarketPollSig.current = sig;

      setTrades(nextTrades);
      if (nextPrices) {
        setPrices((prev) => (JSON.stringify(prev) === JSON.stringify(nextPrices) ? prev : nextPrices));
      }
    } catch (error) {
      console.error('Error fetching market data:', error);
    }
  }, [currentItem, item, isPoll]);

  const getChartRangeBoundsMs = useCallback(() => {
    const now = Date.now();
    if (chartRange === 'ALL') {
      return { fromMs: 0, toMs: now };
    }
    if (chartRange === 'CUSTOM') {
      const fromMs = customRangeFrom ? new Date(customRangeFrom).getTime() : 0;
      const toMs = customRangeTo ? new Date(customRangeTo).getTime() : now;
      return {
        fromMs: Number.isFinite(fromMs) ? fromMs : 0,
        toMs: Number.isFinite(toMs) ? toMs : now,
      };
    }
    const rangeToMs = {
      '1H': 60 * 60 * 1000,
      '6H': 6 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000,
      '1W': 7 * 24 * 60 * 60 * 1000,
      '1M': 30 * 24 * 60 * 60 * 1000,
    };
    const durationMs = rangeToMs[chartRange] || rangeToMs['1D'];
    return { fromMs: now - durationMs, toMs: now };
  }, [chartRange, customRangeFrom, customRangeTo]);

  const getOutcomeSeriesConfig = useCallback(() => {
    if (isPoll) {
      if (itemData.optionType === 'options' && Array.isArray(itemData.options) && itemData.options.length > 0) {
        const palette = [
          '#2563eb', // blue
          '#dc2626', // red
          '#7c3aed', // purple
          '#16a34a', // green
          '#ea580c', // orange
          '#0d9488', // teal
          '#9333ea', // violet
          '#0ea5e9', // sky
        ];
        return itemData.options.map((opt, idx) => ({
          key: String(opt.text),
          label: String(opt.text),
          color: palette[idx % palette.length],
        }));
      }
      return [
        { key: 'YES', label: 'YES', color: '#16a34a' },
        { key: 'NO', label: 'NO', color: '#dc2626' },
      ];
    }
    const series = [
      { key: 'TeamA', label: itemData.teamA || 'Team A', color: '#2563eb' },
      ...(itemData.drawEnabled !== false
        ? [{ key: 'Draw', label: 'Draw', color: '#7c3aed' }]
        : []),
      { key: 'TeamB', label: itemData.teamB || 'Team B', color: '#dc2626' },
    ];
    return series;
  }, [isPoll, itemData.optionType, itemData.options, itemData.teamA, itemData.teamB, itemData.drawEnabled]);

  const rebuildChartDisplay = useCallback(() => {
    const series = getOutcomeSeriesConfig();
    const { fromMs, toMs } = getChartRangeBoundsMs();
    let points = chartHistoryRef.current.filter((p) => p.t >= fromMs && p.t <= toMs);
    if (!points.length && chartHistoryRef.current.length) {
      points = [cloneChartPoint(chartHistoryRef.current[chartHistoryRef.current.length - 1])];
    }
    if (!points.length) {
      const point = { t: Date.now() };
      series.forEach((s) => {
        point[s.key] = outcomeImpliedPrices[s.key] ?? 0;
      });
      points = [point];
    }
    const MAX_POINTS = 250;
    let displayPoints = points;
    if (points.length > MAX_POINTS) {
      const step = Math.ceil(points.length / MAX_POINTS);
      const sampled = [];
      for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
      displayPoints = sampled;
    }
    setChartData(displayPoints.map(cloneChartPoint));
  }, [getOutcomeSeriesConfig, getChartRangeBoundsMs, outcomeImpliedPrices, cloneChartPoint]);

  const fetchOrderbookActivity = useCallback(async () => {
    if (!itemData?.marketId || !outcomeRows.length) return;
    try {
      const keys = outcomeRows.map((r) => r.key).join(',');
      const { data } = await api.get(`/orderbook/market/${itemData.marketId}/activity`, {
        params: {
          optionKeys: keys,
          startingPrices: JSON.stringify(itemData.startingPrices || []),
        },
      });
      const series = getOutcomeSeriesConfig();
      const keysList = series.map((s) => s.key);
      const lastByKey = {};
      keysList.forEach((k) => {
        lastByKey[k] =
          Number(data.impliedNow?.[k]) ||
          Number(outcomeImpliedPrices[k]) ||
          1 / Math.max(1, keysList.length);
      });

      const normalizePoint = (point) => {
        const next = { ...point };
        const sum = keysList.reduce((s, k) => s + (Number(next[k]) || 0), 0) || 1;
        keysList.forEach((k) => {
          next[k] = (Number(next[k]) || 0) / sum;
        });
        return next;
      };

      const points = [];
      const tradeList = Array.isArray(data.trades) ? data.trades : [];
      for (const tr of tradeList) {
        const tms = new Date(tr.t).getTime();
        if (!Number.isFinite(tms)) continue;
        const ok = String(tr.optionKey || '');
        const px = Number(tr.price);
        if (ok && Number.isFinite(px) && px >= 0 && px <= 1) {
          if (String(tr.side).toUpperCase() === 'YES') lastByKey[ok] = px;
          else if (String(tr.side).toUpperCase() === 'NO') lastByKey[ok] = 1 - px;
        }
        const point = normalizePoint({ t: tms, ...Object.fromEntries(keysList.map((k) => [k, lastByKey[k]])) });
        points.push(point);
      }

      const nowPoint = normalizePoint({
        t: Date.now(),
        ...Object.fromEntries(keysList.map((k) => [k, data.impliedNow?.[k] ?? lastByKey[k] ?? 0])),
      });
      if (!points.length) {
        points.push(
          normalizePoint({
            t: Date.now() - 3600000,
            ...Object.fromEntries(keysList.map((k) => [k, lastByKey[k] ?? 0])),
          })
        );
      }
      const lastT = points[points.length - 1]?.t;
      if (!lastT || Math.abs(nowPoint.t - lastT) > 500) points.push(nowPoint);
      else points[points.length - 1] = { ...points[points.length - 1], ...nowPoint };

      chartHistoryRef.current = points;
      lastChartPointSigRef.current = '';
      rebuildChartDisplay();
    } catch (e) {
      console.warn('fetchOrderbookActivity', e?.message || e);
    }
  }, [
    itemData?.marketId,
    itemData.startingPrices,
    outcomeRows,
    getOutcomeSeriesConfig,
    outcomeImpliedPrices,
    rebuildChartDisplay,
  ]);

  useEffect(() => {
    fetchOrderbookActivity();
  }, [fetchOrderbookActivity]);

  useEffect(() => {
    const series = getOutcomeSeriesConfig();
    if (!series.length) return;
    const sig = series.map((s) => `${s.key}:${(outcomeImpliedPrices[s.key] ?? 0).toFixed(4)}`).join('|');
    if (!sig) return;

    const now = Date.now();
    const last = chartHistoryRef.current[chartHistoryRef.current.length - 1];
    if (sig !== lastChartPointSigRef.current) {
      if (last && now - last.t < 1200) {
        const updated = { ...last, t: now };
        series.forEach((s) => {
          updated[s.key] = outcomeImpliedPrices[s.key] ?? 0;
        });
        chartHistoryRef.current = [
          ...chartHistoryRef.current.slice(0, -1),
          updated,
        ];
      } else {
        const point = { t: now };
        series.forEach((s) => {
          point[s.key] = outcomeImpliedPrices[s.key] ?? 0;
        });
        chartHistoryRef.current = [...chartHistoryRef.current, point];
      }
      lastChartPointSigRef.current = sig;
      if (chartHistoryRef.current.length > 600) {
        chartHistoryRef.current = chartHistoryRef.current.slice(-600);
      }
    }
    rebuildChartDisplay();
  }, [
    outcomeImpliedPrices,
    booksByOption,
    chartRange,
    customRangeFrom,
    customRangeTo,
    getOutcomeSeriesConfig,
    rebuildChartDisplay,
  ]);

  const fetchComments = useCallback(async () => {
    try {
      setCommentsLoading(true);
      const itemId = (currentItem || item)?._id || item?._id;
      if (!itemId) return;
      const res = await api.get('/comments/market', {
        params: { type: isPoll ? 'poll' : 'match', itemId },
      });
      setComments(Array.isArray(res.data?.comments) ? res.data.comments : []);
    } catch (e) {
      console.error('Error fetching comments:', e);
    } finally {
      setCommentsLoading(false);
    }
  }, [currentItem, item, isPoll]);

  const fetchUserMarketPrediction = useCallback(async () => {
    const requestUserId = user?._id != null ? String(user._id) : null;
    const itemId = (currentItem || item)?._id || item?._id;
    if (!requestUserId || !itemId) {
      setPredictions({});
      return;
    }
    try {
      const endpoint = isPoll
        ? `/predictions/poll/${itemId}/user?type=market`
        : `/predictions/match/${itemId}/user?type=market`;
      const response = await api.get(endpoint);

      // Handle array of predictions (one per option)
      const predictionsArray = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];

      // Convert to map by outcome
      const predictionsMap = {};
      predictionsArray.forEach((pred) => {
        const outcome = pred.outcome;
        predictionsMap[outcome] = pred;
      });

      setPredictions(predictionsMap);
    } catch (error) {
      setPredictions({});
    }
  }, [currentItem, item, isPoll, user?._id]);

  useEffect(() => {
    fetchMarketData();
    if (user) {
      fetchUserMarketPrediction();
    } else {
      setPredictions({});
    }
    const interval = setInterval(() => {
      fetchMarketData();
    }, 5000);
    return () => clearInterval(interval);
  }, [currentItem, item, user, isPoll, fetchMarketData, fetchUserMarketPrediction]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const submitComment = async () => {
    if (!user) {
      showNotification('Please login to comment', 'warning');
      return;
    }
    const itemId = (currentItem || item)?._id || item?._id;
    const text = String(newComment || '').trim();
    if (!text) {
      showNotification('Comment cannot be empty', 'warning');
      return;
    }
    setCommentSubmitting(true);
    try {
      await api.post('/comments/market', {
        type: isPoll ? 'poll' : 'match',
        itemId,
        content: text,
      });
      setNewComment('');
      await fetchComments();
      showNotification('Comment posted', 'success');
    } catch (e) {
      showNotification(e?.response?.data?.message || 'Failed to post comment', 'error');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const submitReply = async (parentId) => {
    if (!user) {
      showNotification('Please login to reply', 'warning');
      return;
    }
    const itemId = (currentItem || item)?._id || item?._id;
    const text = String(replyText || '').trim();
    if (!text) {
      showNotification('Reply cannot be empty', 'warning');
      return;
    }
    setCommentSubmitting(true);
    try {
      await api.post('/comments/market', {
        type: isPoll ? 'poll' : 'match',
        itemId,
        content: text,
        parentId,
      });
      setReplyText('');
      setReplyingTo(null);
      await fetchComments();
      showNotification('Reply posted', 'success');
    } catch (e) {
      showNotification(e?.response?.data?.message || 'Failed to post reply', 'error');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleTrade = async () => {
    if (!user) {
      showNotification('Please login to trade', 'warning');
      return;
    }

    // Check if locked
    if (locked || itemData.status === 'locked' || (itemData.lockedTime && new Date() >= new Date(itemData.lockedTime))) {
      showNotification('Trading is locked for this match/poll', 'error');
      return;
    }

    if (!selectedOption) {
      showNotification(`Please select ${isPoll ? 'YES or NO' : 'TeamA, TeamB, or Draw'}`, 'warning');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      showNotification('Please enter a valid amount', 'warning');
      return;
    }

    // Wallet will auto-connect when blockchain function is called
    
    try {
      if (tradeType === 'buy') {
        // Check if marketId exists and market is initialized
        if (!itemData.marketId) {
          showNotification('Market not created on blockchain yet. Please wait for admin to create the market.', 'error');
          console.error('MarketId missing for item:', itemData._id, 'Item data:', itemData);
          return;
        }
        
        if (!itemData.marketInitialized) {
          showNotification('Market is not initialized yet. Please wait for admin to initialize the market.', 'error');
          return;
        }
        
        // Normalize outcome to match contract options exactly
        let normalizedOutcome = String(selectedOption || '').trim();
        if (!isPoll) {
          const lower = normalizedOutcome.toLowerCase();
          const teamALower = (itemData.teamA || '').trim().toLowerCase();
          const teamBLower = (itemData.teamB || '').trim().toLowerCase();
          if (lower === 'teama' || (teamALower && lower === teamALower)) {
            normalizedOutcome = 'TeamA';
          } else if (lower === 'teamb' || (teamBLower && lower === teamBLower)) {
            normalizedOutcome = 'TeamB';
          } else if (lower === 'draw') {
            normalizedOutcome = 'Draw';
          }
        } else {
          if (itemData?.optionType === 'options' && Array.isArray(itemData?.options) && itemData.options.length > 0) {
            const matchOpt = itemData.options.find(
              (o) => o && String(o.text).trim().toLowerCase() === normalizedOutcome.toLowerCase()
            );
            if (!matchOpt) {
              showNotification('Invalid option for this poll market. Please refresh and try again.', 'error');
              return;
            }
            normalizedOutcome = String(matchOpt.text).trim();
          } else {
            normalizedOutcome = normalizedOutcome.toUpperCase();
          }
        }
        
        // Optional: validate outcome against contract options to avoid obscure reverts
        // Check wallet gas balance before popping wallet for signature.
        try {
          const amountNum = parseFloat(amount);
          if (!Number.isNaN(amountNum) && amountNum > 0) {
            const linked = await ensureLinkedWallet();
            const ok = await ensureGasOrDrip(linked, { label: 'market buy' });
            if (!ok) return;
          }
        } catch (e) {
          if (String(e?.message || '') === 'WALLET_IN_USE') return;
          console.warn('Could not verify wallet balance before market buy:', e);
        }

        try {
          const contractOptions = await getMarketOptions(itemData.marketId);
          if (contractOptions.length > 0) {
            const outcomeTrimmed = String(normalizedOutcome || '').trim();
            const isAllowed = contractOptions.some((o) => String(o || '').trim() === outcomeTrimmed);
            if (!isAllowed) {
              showNotification(
                `Your selection is not a valid option on the blockchain. Valid: ${contractOptions.join(', ')}.`,
                'error'
              );
              return;
            }
          }
        } catch (_) {
          // If getMarketOptions fails (e.g. old contract), continue with buy
        }

        try {
          // Buy on blockchain first - wait for transaction to complete
          showNotification('Sending transaction to blockchain...', 'info');
          const txHash = await buyMarketShares(itemData.marketId, normalizedOutcome, parseFloat(amount));
          showNotification(`Transaction confirmed! TX: ${txHash.slice(0, 10)}...`, 'success');

          try {
            await api.post('/transactions', {
              action: 'market_buy',
              txHash,
              amount: parseFloat(amount),
              currency: 'USDC',
              itemType: isPoll ? 'poll' : 'match',
              itemId: itemData._id,
              meta: { outcome: normalizedOutcome },
            });
          } catch {
            // ignore logging failures
          }
          
          // Then process in backend only after blockchain success
          const linked = await ensureLinkedWallet();
          const buyResponse = await api.post('/predictions/market/buy', {
            [isPoll ? 'pollId' : 'matchId']: itemData._id,
            outcome: selectedOption,
            amount: parseFloat(amount),
            walletAddress: linked || undefined,
          });
        
        // Update item immediately with response data if available
        if (buyResponse.data.updatedItem) {
          setCurrentItem(buyResponse.data.updatedItem);
          if (onItemUpdate) {
            onItemUpdate(buyResponse.data.updatedItem);
          }
        }
        
        // Update prices if provided - this ensures ALL prices update (not just the traded one)
        if (buyResponse.data.updatedPrices) {
          setPrices(buyResponse.data.updatedPrices);
        }
        
          // Force refresh user predictions to get updated share values
          await fetchUserMarketPrediction();
          
          showNotification('Buy order executed successfully!', 'success');
        } catch (blockchainError) {
          console.error('Blockchain transaction failed:', blockchainError);
          showNotification(getBlockchainErrorMessage(blockchainError), 'error');
          return; // Exit early, don't process backend
        }
      } else {
        // For sell, we need to specify outcome, shares or use 'max'
        if (!selectedOption) {
          showNotification('Please select an option to sell', 'warning');
          return;
        }
        
        // Find the prediction for this option (try multiple variations)
        let optionPrediction = predictions[selectedOption];
        if (!optionPrediction) {
          optionPrediction = predictions[selectedOption.toUpperCase()] || 
                           predictions[selectedOption.toLowerCase()] ||
                           predictions[selectedOption.charAt(0).toUpperCase() + selectedOption.slice(1).toLowerCase()];
        }
        
        // For matches, also try normalized versions
        if (!optionPrediction && !isPoll) {
          const normalized = selectedOption === 'teamA' ? 'TEAMA' : 
                            selectedOption === 'teamB' ? 'TEAMB' : 
                            selectedOption === 'draw' ? 'DRAW' : selectedOption.toUpperCase();
          optionPrediction = predictions[normalized];
        }
        
        if (!optionPrediction || (optionPrediction.shares || 0) <= 0) {
          showNotification('No shares to sell for this option', 'warning');
          return;
        }
        
        // Use the prediction's stored outcome (this is what's in the database)
        const outcomeToSend = optionPrediction.outcome || selectedOption;
        const availableShares = optionPrediction.shares || 0;
        
        // Handle max button - convert to actual number
        let sharesToSell;
        if (amount === 'max' || amount === 'all') {
          sharesToSell = 'max';
        } else {
          const parsedAmount = parseFloat(amount);
          if (isNaN(parsedAmount) || parsedAmount <= 0) {
            showNotification('Please enter a valid amount', 'warning');
            return;
          }
          if (parsedAmount > availableShares) {
            showNotification(`Cannot sell more than ${availableShares.toFixed(4)} shares`, 'warning');
            return;
          }
          sharesToSell = parsedAmount;
        }
        
        // Normalize outcome for blockchain (match: TeamA/TeamB/Draw; poll: YES/NO or exact option text)
        let normalizedOutcome = String(outcomeToSend || selectedOption || '').trim();
        if (!isPoll) {
          const lower = normalizedOutcome.toLowerCase();
          const teamALower = (itemData.teamA || '').trim().toLowerCase();
          const teamBLower = (itemData.teamB || '').trim().toLowerCase();
          if (lower === 'teama' || (teamALower && lower === teamALower)) {
            normalizedOutcome = 'TeamA';
          } else if (lower === 'teamb' || (teamBLower && lower === teamBLower)) {
            normalizedOutcome = 'TeamB';
          } else if (lower === 'draw') {
            normalizedOutcome = 'Draw';
          }
          if (normalizedOutcome !== 'TeamA' && normalizedOutcome !== 'TeamB' && normalizedOutcome !== 'Draw') {
            showNotification('Could not determine outcome for this match. Please try again.', 'error');
            return;
          }
        } else {
          if (itemData?.optionType === 'options' && Array.isArray(itemData?.options) && itemData.options.length > 0) {
            const matchOpt = itemData.options.find(
              (o) => o && String(o.text).trim().toLowerCase() === normalizedOutcome.toLowerCase()
            );
            if (!matchOpt) {
              showNotification('Invalid option for this poll. Please refresh and try again.', 'error');
              return;
            }
            normalizedOutcome = String(matchOpt.text).trim();
          } else {
            normalizedOutcome = normalizedOutcome.toUpperCase();
          }
        }
        
        // Calculate actual shares to sell
        const actualShares = sharesToSell === 'max' ? availableShares : sharesToSell;
        
        try {
          // Ensure the connected wallet is linked to this account before trading.
          await ensureLinkedWallet();

          // Gas-drip before sell if user has no Base ETH for gas.
          try {
            const linked = await ensureLinkedWallet();
            const ok = await ensureGasOrDrip(linked, { label: 'market sell' });
            if (!ok) return;
          } catch (e) {
            if (String(e?.message || '') === 'WALLET_IN_USE') return;
          }

          // Sell on blockchain first - wait for transaction to complete
          showNotification('Sending transaction to blockchain...', 'info');
          const txHash = await sellMarketShares(itemData.marketId, normalizedOutcome, actualShares);
          showNotification(`Transaction confirmed! TX: ${txHash.slice(0, 10)}...`, 'success');

          try {
            await api.post('/transactions', {
              action: 'market_sell',
              txHash,
              amount: actualShares,
              currency: 'USDC',
              itemType: isPoll ? 'poll' : 'match',
              itemId: itemData._id,
              meta: { outcome: normalizedOutcome, shares: actualShares },
            });
          } catch {
            // ignore logging failures
          }
          
          // Then process in backend only after blockchain success
          const sellResponse = await api.post('/predictions/market/sell', {
            [isPoll ? 'pollId' : 'matchId']: itemData._id,
            outcome: outcomeToSend, // Use the stored outcome from prediction
            shares: sharesToSell,
          });
        
        // Update item immediately with response data if available
        if (sellResponse.data.updatedItem) {
          setCurrentItem(sellResponse.data.updatedItem);
          if (onItemUpdate) {
            onItemUpdate(sellResponse.data.updatedItem);
          }
        }
        
        // Update prices if provided - this ensures ALL prices update (not just the traded one)
        if (sellResponse.data.updatedPrices) {
          setPrices(sellResponse.data.updatedPrices);
        }
        
          // Force refresh user predictions to get updated share values
          await fetchUserMarketPrediction();
          
          showNotification('Sell order executed successfully!', 'success');
        } catch (blockchainError) {
          console.error('Blockchain transaction failed:', blockchainError);
          showNotification(getBlockchainErrorMessage(blockchainError), 'error');
          return; // Exit early, don't process backend
        }
      }
      setAmount('');
      
      // Immediately refresh all data after trade
      // Refresh item data to get updated liquidity
      const itemResponse = isPoll 
        ? await api.get(`/polls/${itemData._id}`)
        : await api.get(`/matches/${itemData._id}`);
      
      // Update current item state
      setCurrentItem(itemResponse.data);
      
      // Update item in parent component if callback provided
      if (onItemUpdate) {
        onItemUpdate(itemResponse.data);
      }
      
      // Refresh market data and user predictions
      await Promise.all([
        fetchMarketData(),
        fetchUserMarketPrediction()
      ]);
    } catch (error) {
      showNotification(error.response?.data?.message || 'Trade failed', 'error');
    }
  };

  // Claiming is handled per-option via on-chain claim buttons elsewhere

  const fetchOptionBooks = useCallback(
    async (optionKey) => {
      const chainMarketId = itemData?.marketId;
      const key = String(optionKey || '').trim();
      if (!chainMarketId || !key) return;
      try {
        const [yesRes, noRes] = await Promise.all([
          api.get(`/orderbook/book/${chainMarketId}`, { params: { optionKey: key, side: 'YES' } }),
          api.get(`/orderbook/book/${chainMarketId}`, { params: { optionKey: key, side: 'NO' } }),
        ]);
        setBooksByOption((prev) => ({
          ...prev,
          [key]: {
            YES: yesRes.data || { bids: [], asks: [] },
            NO: noRes.data || { bids: [], asks: [] },
          },
        }));
      } catch {
        setBooksByOption((prev) => ({
          ...prev,
          [key]: { YES: { bids: [], asks: [] }, NO: { bids: [], asks: [] } },
        }));
      }
    },
    [itemData?.marketId]
  );

  useEffect(() => {
    if (!itemData?.marketId) return;
    fetchAllOptionBooks();
    fetchOrderbookActivity();
    const id = setInterval(() => {
      fetchAllOptionBooks();
      fetchOrderbookActivity();
      if (user) fetchTradingPanel({ silent: true });
    }, 5000);
    return () => clearInterval(id);
  }, [itemData?.marketId, fetchAllOptionBooks, fetchOrderbookActivity, user, fetchTradingPanel]);

  const cancelAllOpenOrders = useCallback(async () => {
    if (!myOrders.length) return;
    setCancelingAllOrders(true);
    try {
      for (const o of myOrders) {
        const oid = o._id ?? o.id;
        if (oid) await cancelOrderbookOrder(oid);
      }
      await fetchMyOrders({ force: true });
      await fetchAllOptionBooks({ force: true });
      showNotification('Open orders cancelled', 'success');
    } catch (e) {
      showNotification(e?.response?.data?.message || e?.message || 'Cancel all failed', 'error');
    } finally {
      setCancelingAllOrders(false);
    }
  }, [myOrders, cancelOrderbookOrder, fetchMyOrders, fetchAllOptionBooks, showNotification]);

  const closeAllPositions = useCallback(async () => {
    if (!positionTableRows.length || isResolved || locked) return;
    setClosingAllPositions(true);
    try {
      for (const r of positionTableRows) {
        await closeOrderbookPosition(r.positionKey, r.shares);
      }
      await Promise.all([
        fetchOrderbookPositions({ force: true }),
        fetchAllOptionBooks({ force: true }),
      ]);
    } catch (e) {
      showNotification(e?.response?.data?.message || e?.message || 'Close all failed', 'error');
    } finally {
      setClosingAllPositions(false);
    }
  }, [
    positionTableRows,
    isResolved,
    locked,
    closeOrderbookPosition,
    fetchOrderbookPositions,
    fetchAllOptionBooks,
    showNotification,
  ]);

  const handleBack = () => {
    if (item.cup && item.cup.slug) {
      navigate(`/cup/${item.cup.slug}`);
    } else {
      navigate(-1);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back Button and Status Tags */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={handleBack}
            className="flex items-center text-gray-600 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="font-medium">Back to Cup</span>
          </button>
          <div className="flex items-center gap-2">
            {/* Status Tag */}
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              isPoll 
                ? (itemData.status === 'upcoming' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                   itemData.status === 'active' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                   itemData.status === 'locked' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                   'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200')
                : (itemData.status === 'upcoming' ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' :
                   itemData.status === 'live' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                   itemData.status === 'locked' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200' :
                   'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200')
            }`}>
              {itemData.status?.toUpperCase() || 'N/A'}
            </span>
            {/* Resolved Tag */}
            {itemData.isResolved && (
              <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
                RESOLVED
              </span>
            )}
          </div>
        </div>
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          {!isPoll && (
            <div className="flex items-center justify-center gap-8 mb-6">
              <div className="flex flex-col items-center">
                {itemData.teamAImage && (
                  <img src={itemData.teamAImage} alt={itemData.teamA} className="w-24 h-24 object-cover rounded-full mb-2 border-4 border-gray-200 dark:border-gray-700" />
                )}
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{itemData.teamA}</h2>
              </div>
              <div className="text-2xl font-bold text-gray-500 dark:text-gray-400">VS</div>
              <div className="flex flex-col items-center">
                {itemData.teamBImage && (
                  <img src={itemData.teamBImage} alt={itemData.teamB} className="w-24 h-24 object-cover rounded-full mb-2 border-4 border-gray-200 dark:border-gray-700" />
                )}
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{itemData.teamB}</h2>
              </div>
            </div>
          )}
          {isPoll ? (
            <div className="flex items-start gap-4">
              {itemData.thumbnailImage ? (
                <img
                  src={itemData.thumbnailImage}
                  alt={itemData.question}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-200 dark:border-gray-700 flex-shrink-0"
                />
              ) : null}
              <div className="min-w-0">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 text-left break-words">
                  {itemData.question}
                </h1>
                <p className="text-gray-600 dark:text-gray-400 text-left break-words">
                  {itemData.description}
                </p>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 text-center">
                {`${itemData.teamA} vs ${itemData.teamB}`}
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-center">
                {`${new Date(itemData.date).toLocaleDateString()} • ${itemData.stageName || ''}`}
              </p>
            </>
          )}
          {isResolved && (
            <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900 rounded-lg">
              <p className="text-lg font-semibold text-gray-900 dark:text-white">
                Resolved: <strong>{resolvedOutcome}</strong>
              </p>
            </div>
          )}
          <div className="mt-4 bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
            <div className="text-sm text-green-600 dark:text-green-400 font-semibold mb-1">Jackpot pool</div>
            <div className="text-xl font-bold text-green-700 dark:text-green-300">
              {formatUsdAmount(
                itemData.isResolved && itemData.originalFreeJackpotPool
                  ? itemData.originalFreeJackpotPool
                  : itemData.freeJackpotPool || 0
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
          {/* 1. Price Chart - first on mobile */}
          <div className="order-1 md:col-span-3 space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                    Price Chart
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    {['1H', '6H', '1D', '1W', '1M', 'ALL', 'CUSTOM'].map((range) => (
                      <button
                        key={range}
                        type="button"
                        onClick={() => setChartRange(range)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                          chartRange === range
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {range === 'CUSTOM' ? 'Custom' : range}
                      </button>
                    ))}
                  </div>
                </div>

                {chartRange === 'CUSTOM' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        From
                      </label>
                      <input
                        type="datetime-local"
                        value={customRangeFrom}
                        onChange={(e) => setCustomRangeFrom(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                        To
                      </label>
                      <input
                        type="datetime-local"
                        value={customRangeTo}
                        onChange={(e) => setCustomRangeTo(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-white text-sm"
                      />
                    </div>
                  </div>
                )}

                <div className="h-72 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.25} />
                      <XAxis
                        dataKey="t"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(v) => {
                          const d = new Date(v);
                          return chartRange === '1H' || chartRange === '6H'
                            ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                        }}
                        tick={{ fontSize: 12, fill: '#6b7280' }}
                        axisLine={{ strokeOpacity: 0.3 }}
                        tickLine={{ strokeOpacity: 0.3 }}
                      />
                      <YAxis
                        domain={[0, 1]}
                        tickFormatter={(v) => `${Math.round(v * 100)}%`}
                        tick={{ fontSize: 12, fill: '#6b7280' }}
                        axisLine={{ strokeOpacity: 0.3 }}
                        tickLine={{ strokeOpacity: 0.3 }}
                      />
                      <Tooltip
                        formatter={(value, name) => [`${(Number(value) * 100).toFixed(1)}%`, name]}
                        labelFormatter={(label) => new Date(label).toLocaleString()}
                      />
                      <Legend />
                      {getOutcomeSeriesConfig().map((s) => (
                        <Line
                          key={s.key}
                          type="monotone"
                          dataKey={s.key}
                          name={s.label}
                          stroke={s.color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                  {getOutcomeSeriesConfig().map((s) => {
                    const latest = chartData?.length ? chartData[chartData.length - 1]?.[s.key] : null;
                    return (
                      <div key={s.key} className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="font-semibold text-gray-700 dark:text-gray-200">{s.label}</span>
                        <span>{latest != null ? `${(Number(latest) * 100).toFixed(1)}%` : '--'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Outcomes + per-outcome orderbook */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Markets</h2>
                <span className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
                  Live
                </span>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-700">
                {rankedOutcomeRows.map((o) => {
                    const isActive = selectedOption === o.key;
                    const isOpen = expandedOption === o.key;
                    const books = booksByOption[o.key];
                    const best = (sideKey) => {
                      const b = books?.[sideKey];
                      const bestBid = b?.bids?.length ? Number(b.bids[0].limitPrice) : null;
                      const bestAsk = b?.asks?.length ? Number(b.asks[0].limitPrice) : null;
                      const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
                      return { bestBid, bestAsk, spread };
                    };
                    const yes = best('YES');
                    const no = best('NO');
                    const yesBook = books?.YES;
                    const noBook = books?.NO;
                    const depthTotal = restingBookDepthUsdc(yesBook) + restingBookDepthUsdc(noBook);
                    const yesAsk = yes.bestAsk != null ? yes.bestAsk.toFixed(3) : '—';
                    const noAsk = no.bestAsk != null ? no.bestAsk.toFixed(3) : '—';

                    return (
                      <div key={o.key} className="bg-white dark:bg-gray-800">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOption(o.key);
                              setExpandedOption((prev) => (prev === o.key ? null : o.key));
                            }}
                            className="flex flex-1 min-w-0 items-center gap-3 text-left rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors p-1 -m-1"
                          >
                            <OutcomeOptionAvatar image={o.image} label={o.label} />
                            <div className="min-w-0 flex-1 flex items-stretch justify-between gap-4">
                              <div className="min-w-0 flex-1">
                              <div className="font-semibold text-slate-900 dark:text-white text-base leading-snug">
                                <span className="truncate block">{o.label}</span>
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                Vol{' '}
                                <span className="tabular-nums font-semibold text-slate-700 dark:text-slate-200">
                                  {formatUsdAmount(depthTotal)}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                                Tap to {isOpen ? 'collapse' : 'expand'} order book
                              </div>
                              </div>
                              <span className="self-center shrink-0 min-w-[3.25rem] pl-2 text-right text-2xl sm:text-3xl font-bold tabular-nums leading-none text-slate-800 dark:text-slate-100">
                                {o.volumePct != null ? `${o.volumePct.toFixed(0)}%` : '—'}
                              </span>
                            </div>
                          </button>

                          <div className="flex items-center justify-end gap-2 shrink-0 sm:pl-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOption(o.key);
                                setSelectedSide('YES');
                              }}
                              className={`min-w-[6.5rem] px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border transition-all flex items-center justify-between gap-3 ${
                                isActive && selectedSide === 'YES'
                                  ? 'bg-emerald-600 border-emerald-600 text-white shadow-md ring-2 ring-emerald-500/25'
                                  : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                              }`}
                            >
                              <span>Yes</span>
                              <span className="tabular-nums font-semibold opacity-95">{yesAsk}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedOption(o.key);
                                setSelectedSide('NO');
                              }}
                              className={`min-w-[6.5rem] px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border transition-all flex items-center justify-between gap-3 ${
                                isActive && selectedSide === 'NO'
                                  ? 'bg-rose-600 border-rose-600 text-white shadow-md ring-2 ring-rose-500/25'
                                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-100 hover:bg-rose-100 dark:hover:bg-rose-900/50'
                              }`}
                            >
                              <span>No</span>
                              <span className="tabular-nums font-semibold opacity-95">{noAsk}</span>
                            </button>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 px-4 py-4">
                            <div className="grid md:grid-cols-2 gap-4 text-xs">
                              {['YES', 'NO'].map((sideKey) => {
                                const b = books?.[sideKey] || { bids: [], asks: [] };
                                const topBids = (b.bids || []).slice(0, 80);
                                const topAsks = (b.asks || []).slice(0, 80);
                                const bb = topBids.length ? Number(topBids[0].limitPrice) : null;
                                const ba = topAsks.length ? Number(topAsks[0].limitPrice) : null;
                                const sp = bb != null && ba != null ? ba - bb : null;
                                const scrollCol = 'max-h-[260px] overflow-y-auto overscroll-contain pr-1';
                                return (
                                  <div
                                    key={sideKey}
                                    className="rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-gray-800/90 overflow-hidden shadow-sm"
                                  >
                                    <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-600 flex items-center justify-between bg-slate-100/80 dark:bg-slate-800/80">
                                      <span className="font-bold text-slate-900 dark:text-white">{sideKey}</span>
                                      <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                                        Mid {bb != null && ba != null ? ((bb + ba) / 2).toFixed(3) : '—'} · Spread{' '}
                                        {sp != null ? sp.toFixed(3) : '—'}
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-600">
                                      <div className={`p-3 ${scrollCol}`}>
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2 pb-1 border-b border-emerald-200/60 dark:border-emerald-800/50">
                                          Bid
                                        </div>
                                        <div className="grid grid-cols-2 gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5 sticky top-0 bg-white dark:bg-gray-800/95 pb-1 z-[1]">
                                          <span>Price</span>
                                          <span className="text-right">Shares</span>
                                        </div>
                                        {topBids.length ? (
                                          topBids.map((r) => (
                                            <div key={r._id} className="grid grid-cols-2 gap-1 text-emerald-700 dark:text-emerald-300 tabular-nums py-0.5 text-[11px]">
                                              <span>{Number(r.limitPrice).toFixed(3)}</span>
                                              <span className="text-right text-slate-600 dark:text-slate-300">{r.sizeRemaining}</span>
                                            </div>
                                          ))
                                        ) : (
                                          <div className="text-slate-400 py-2">—</div>
                                        )}
                                      </div>
                                      <div className={`p-3 ${scrollCol}`}>
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-2 pb-1 border-b border-rose-200/60 dark:border-rose-800/50">
                                          Ask
                                        </div>
                                        <div className="grid grid-cols-2 gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5 sticky top-0 bg-white dark:bg-gray-800/95 pb-1 z-[1]">
                                          <span>Price</span>
                                          <span className="text-right">Shares</span>
                                        </div>
                                        {topAsks.length ? (
                                          topAsks.map((r) => (
                                            <div key={r._id} className="grid grid-cols-2 gap-1 text-rose-700 dark:text-rose-300 tabular-nums py-0.5 text-[11px]">
                                              <span>{Number(r.limitPrice).toFixed(3)}</span>
                                              <span className="text-right text-slate-600 dark:text-slate-300">{r.sizeRemaining}</span>
                                            </div>
                                          ))
                                        ) : (
                                          <div className="text-slate-400 py-2">—</div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Your position (table) */}
            {user && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Your position</h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Holdings from executed trades. Fills settling on-chain appear below; open limits are under Open orders.
                    </p>
                    {isResolved && (
                      <p className="mt-2 text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                        This market is resolved. Open orders were cancelled and vault collateral released. Position USDC was
                        moved to the claim pool — use Claim on winning predictions to withdraw.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await Promise.all([
                        fetchTradingPanel({ silent: true, force: true }),
                        fetchAllOptionBooks({ force: true }),
                        fetchOrderbookActivity(),
                      ]);
                    }}
                    className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-400 transition-colors shadow-sm dark:shadow-none"
                  >
                    Refresh
                  </button>
                </div>

                <div className="space-y-6">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">Positions</div>
                      {positionTableRows.length > 0 && !isResolved && (
                        <button
                          type="button"
                          disabled={closingAllPositions || !!closingPositionKey}
                          onClick={closeAllPositions}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                        >
                          {closingAllPositions ? 'Closing all…' : 'Close all positions'}
                        </button>
                      )}
                    </div>
                    <div className="relative min-h-[9rem]">
                    {orderbookPositionsLoading && !positionsEverLoadedRef.current ? (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/60 dark:bg-gray-800/60 z-[1]">
                        <span className="text-sm text-gray-500 dark:text-gray-400">Loading…</span>
                      </div>
                    ) : null}
                    {positionTableRows.length === 0 ? (
                      <div className="text-sm text-gray-500 dark:text-gray-400 py-6">No filled positions yet.</div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700/80">
                        <table className="min-w-full text-sm text-gray-900 dark:text-gray-100">
                          <thead>
                            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40">
                              <th className="py-2.5 pr-4 pl-1">Side</th>
                              <th className="py-2.5 pr-4">Quantity</th>
                              <th className="py-2.5 pr-4">Avg</th>
                              <th className="py-2.5 pr-4">Current</th>
                              <th className="py-2.5 pr-4">PnL</th>
                              <th className="py-2.5 pr-4">Potential win</th>
                              <th className="py-2.5 pr-1">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/80">
                            {positionTableRows
                              .slice(
                                (positionsPage - 1) * marketTablePageSize,
                                positionsPage * marketTablePageSize
                              )
                              .map((r) => (
                              <tr
                                key={r.positionKey}
                                className="border-b border-gray-100 dark:border-gray-700/60 last:border-0 hover:bg-gray-50/80 dark:hover:bg-gray-900/30"
                              >
                                <td className="py-2.5 pr-4 pl-1 text-gray-900 dark:text-white">
                                  <div className="font-medium">{r.optionLabel}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">{r.side}</div>
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {Number(r.shares || 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {r.avgPrice != null ? Number(r.avgPrice).toFixed(4) : '—'}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {r.currentPrice != null ? Number(r.currentPrice).toFixed(4) : '—'}
                                </td>
                                <td
                                  className={`py-2.5 pr-4 tabular-nums ${
                                    r.pnl != null && r.pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  {r.pnl != null ? formatUsdAmount(r.pnl) : '—'}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-emerald-700 dark:text-emerald-300 font-medium">
                                  {!isResolved && r.potentialWin > 0
                                    ? formatUsdAmount(r.potentialWin)
                                    : '—'}
                                </td>
                                <td className="py-2.5 pr-1">
                                  {isResolved ? (
                                    <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums" aria-hidden>
                                      —
                                    </span>
                                  ) : closingPositionKey === r.positionKey ? (
                                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                                      Closing…
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => closeOrderbookPosition(r.positionKey, r.shares)}
                                      disabled={!!closingPositionKey}
                                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline disabled:opacity-50 disabled:no-underline"
                                    >
                                      Close
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {positionTableRows.length > marketTablePageSize && (
                      <div className="flex items-center justify-between mt-2 text-xs text-gray-600 dark:text-gray-400">
                        <span>
                          Page {positionsPage} of {Math.ceil(positionTableRows.length / marketTablePageSize)}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={positionsPage <= 1}
                            onClick={() => setPositionsPage((p) => Math.max(1, p - 1))}
                            className="px-2 py-1 rounded border disabled:opacity-40"
                          >
                            Prev
                          </button>
                          <button
                            type="button"
                            disabled={positionsPage >= Math.ceil(positionTableRows.length / marketTablePageSize)}
                            onClick={() => setPositionsPage((p) => p + 1)}
                            className="px-2 py-1 rounded border disabled:opacity-40"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                    </div>
                  </div>

                  {!isResolved && settlingOrders.length > 0 && (
                    <div>
                          <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                            Settling fills &amp; pending settlement
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                            Filled size confirming on-chain, not yet in Positions, or aggressive limits above/below the
                            market waiting to match (e.g. buy above best ask).
                          </p>
                          <div className="overflow-x-auto rounded-lg border border-amber-100 dark:border-amber-900/50">
                            <table className="min-w-full text-sm text-gray-900 dark:text-gray-100">
                              <thead>
                                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-amber-50/80 dark:bg-amber-950/30">
                                  <th className="py-2.5 pr-4 pl-1">Option</th>
                                  <th className="py-2.5 pr-4">Side</th>
                                  <th className="py-2.5 pr-4">Dir</th>
                                  <th className="py-2.5 pr-4">Filled</th>
                                  <th className="py-2.5 pr-4">Remaining</th>
                                  <th className="py-2.5 pr-4">Price</th>
                                  <th className="py-2.5 pr-4">Status</th>
                                  <th className="py-2.5 pr-1">Note</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/80">
                                {settlingOrders
                                  .slice(
                                    (settlingPage - 1) * marketTablePageSize,
                                    settlingPage * marketTablePageSize
                                  )
                                  .map((o) => (
                                  <tr key={o._id} className="hover:bg-amber-50/50 dark:hover:bg-amber-950/20">
                                    <td className="py-2.5 pr-4 pl-1 font-medium">
                                      {orderbookOptionLabelByKey.get(o.optionKey) || o.optionKey}
                                    </td>
                                    <td className="py-2.5 pr-4">{o.side}</td>
                                    <td className="py-2.5 pr-4 capitalize">{o.direction}</td>
                                    <td className="py-2.5 pr-4 tabular-nums">{Number(o.sizeFilled || 0).toFixed(4)}</td>
                                    <td className="py-2.5 pr-4 tabular-nums">{Number(o.sizeRemaining || 0).toFixed(4)}</td>
                                    <td className="py-2.5 pr-4 tabular-nums">
                                      {o.limitPrice != null ? Number(o.limitPrice).toFixed(3) : '—'}
                                    </td>
                                    <td className="py-2.5 pr-4 text-xs">
                                      {formatOrderbookOrderStatusLabel(normalizeTradeOrderStatus(o)).label}
                                    </td>
                                    <td className="py-2.5 pr-1 text-xs text-amber-800 dark:text-amber-200">
                                      {o.crossingUnfilled
                                        ? 'Crossing spread — awaiting match'
                                        : o.settlementPending
                                          ? 'On-chain settlement pending'
                                          : o.fillNotInPositionYet
                                            ? 'Updating position…'
                                            : 'Recently filled'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {settlingOrders.length > marketTablePageSize && (
                            <div className="flex items-center justify-between mt-2 text-xs text-gray-600 dark:text-gray-400">
                              <span>
                                Page {settlingPage} of {Math.ceil(settlingOrders.length / marketTablePageSize)}
                              </span>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={settlingPage <= 1}
                                  onClick={() => setSettlingPage((p) => Math.max(1, p - 1))}
                                  className="px-2 py-1 rounded border disabled:opacity-40"
                                >
                                  Prev
                                </button>
                                <button
                                  type="button"
                                  disabled={settlingPage >= Math.ceil(settlingOrders.length / marketTablePageSize)}
                                  onClick={() => setSettlingPage((p) => p + 1)}
                                  className="px-2 py-1 rounded border disabled:opacity-40"
                                >
                                  Next
                                </button>
                              </div>
                            </div>
                          )}
                    </div>
                  )}

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white">Open orders (this market)</div>
                      {myOrders.length > 0 && (
                        <button
                          type="button"
                          disabled={cancelingAllOrders || !!cancelingOrderId}
                          onClick={cancelAllOpenOrders}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                        >
                          {cancelingAllOrders ? 'Canceling all…' : 'Cancel all open orders'}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      Working limits with size still open (including partial fills — see Filled column). Passive resting
                      quotes are listed below.
                    </p>
                    {myOrdersLoading && !ordersEverLoadedRef.current ? (
                      <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading…</div>
                    ) : myOrders.length === 0 ? (
                      <div className="text-sm text-gray-500 dark:text-gray-400">No open or partially filled orders for this market.</div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700/80">
                        <table className="min-w-full text-sm text-gray-900 dark:text-gray-100">
                          <thead>
                            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40">
                              <th className="py-2.5 pr-4 pl-1">Option</th>
                              <th className="py-2.5 pr-4">Side</th>
                              <th className="py-2.5 pr-4">Dir</th>
                              <th className="py-2.5 pr-4">Type</th>
                              <th className="py-2.5 pr-4">Shares</th>
                              <th className="py-2.5 pr-4">Filled</th>
                              <th className="py-2.5 pr-4">Price</th>
                              <th className="py-2.5 pr-4">Remaining</th>
                              <th className="py-2.5 pr-4">Status</th>
                              <th className="py-2.5 pr-1">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/80">
                            {myOrders
                              .slice((ordersPage - 1) * marketTablePageSize, ordersPage * marketTablePageSize)
                              .map((o) => (
                              <tr
                                key={o._id}
                                className="border-b border-gray-100 dark:border-gray-700/60 last:border-0 hover:bg-gray-50/80 dark:hover:bg-gray-900/30"
                              >
                                <td className="py-2.5 pr-4 pl-1 text-gray-900 dark:text-white font-medium">
                                  {orderbookOptionLabelByKey.get(o.optionKey) || o.optionKey}
                                </td>
                                <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200">{o.side}</td>
                                <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200 capitalize">{o.direction}</td>
                                <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200 capitalize text-xs">
                                  {String(o.orderKind || 'limit')}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {Number(o.sizeOriginal ?? o.size ?? 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {Number(o.sizeFilled ?? 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {o.limitPrice != null ? Number(o.limitPrice).toFixed(3) : '—'}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums text-gray-800 dark:text-gray-200">
                                  {Number(o.sizeRemaining || 0).toFixed(4)}
                                </td>
                                <td className="py-2.5 pr-4 text-gray-800 dark:text-gray-200 text-xs">
                                  {(() => {
                                    const st = normalizeTradeOrderStatus(o);
                                    const { label, filled } = formatOrderbookOrderStatusLabel(st);
                                    return filled ? (
                                      <span className="text-emerald-600 dark:text-emerald-400 font-medium">{label}</span>
                                    ) : (
                                      <span>{label}</span>
                                    );
                                  })()}
                                </td>
                                <td className="py-2.5 pr-1">
                                  {['open', 'partially_filled', 'pending'].includes(normalizeTradeOrderStatus(o)) ? (
                                    cancelingOrderId === String(o._id ?? o.id) ? (
                                      <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                                        Canceling…
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={!!cancelingOrderId}
                                        onClick={async () => {
                                          const oid = o._id ?? o.id;
                                          setCancelingOrderId(String(oid));
                                          try {
                                            await cancelOrderbookOrder(oid);
                                            await fetchMyOrders({ force: true });
                                            await fetchAllOptionBooks({ force: true });
                                          } finally {
                                            setCancelingOrderId(null);
                                          }
                                        }}
                                        className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-800 dark:hover:text-rose-300 hover:underline disabled:opacity-50 disabled:no-underline"
                                      >
                                        Cancel
                                      </button>
                                    )
                                  ) : (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {myOrders.length > marketTablePageSize && (
                      <div className="flex items-center justify-between mt-2 text-xs text-gray-600 dark:text-gray-400">
                        <span>
                          Page {ordersPage} of {Math.ceil(myOrders.length / marketTablePageSize)}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={ordersPage <= 1}
                            onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                            className="px-2 py-1 rounded border disabled:opacity-40"
                          >
                            Prev
                          </button>
                          <button
                            type="button"
                            disabled={ordersPage >= Math.ceil(myOrders.length / marketTablePageSize)}
                            onClick={() => setOrdersPage((p) => p + 1)}
                            className="px-2 py-1 rounded border disabled:opacity-40"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/*
                  {!isResolved && restingLiquidityOrders.length > 0 && (
                    <div>
                      <div className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                        Resting liquidity (on book)
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                        Passive limits on the order book (not crossing the spread). Includes market-maker quotes.
                      </p>
                      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700/80">
                        <table className="min-w-full text-sm text-gray-900 dark:text-gray-100">
                          <thead>
                            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40">
                              <th className="py-2.5 pr-4 pl-1">Option</th>
                              <th className="py-2.5 pr-4">Dir</th>
                              <th className="py-2.5 pr-4">Remaining</th>
                              <th className="py-2.5 pr-4">Limit</th>
                              <th className="py-2.5 pr-4">Best bid</th>
                              <th className="py-2.5 pr-4">Best ask</th>
                              <th className="py-2.5 pr-1">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/80">
                            {restingLiquidityOrders.map((o) => (
                              <tr key={o._id}>
                                <td className="py-2.5 pr-4 pl-1">
                                  {orderbookOptionLabelByKey.get(o.optionKey) || o.optionKey} · {o.side}
                                </td>
                                <td className="py-2.5 pr-4 capitalize">{o.direction}</td>
                                <td className="py-2.5 pr-4 tabular-nums">{Number(o.sizeRemaining || 0).toFixed(4)}</td>
                                <td className="py-2.5 pr-4 tabular-nums">{Number(o.limitPrice).toFixed(3)}</td>
                                <td className="py-2.5 pr-4 tabular-nums">
                                  {o.bestBid != null ? Number(o.bestBid).toFixed(3) : '—'}
                                </td>
                                <td className="py-2.5 pr-4 tabular-nums">
                                  {o.bestAsk != null ? Number(o.bestAsk).toFixed(3) : '—'}
                                </td>
                                <td className="py-2.5 pr-1">
                                  <button
                                    type="button"
                                    disabled={!!cancelingOrderId}
                                    onClick={() => cancelOrderbookOrder(o._id ?? o.id)}
                                    className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  */}
                </div>
              </div>
            )}

            {/* Comments - Market only */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Comments</h2>
              </div>
              <div className="space-y-3">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder={user ? 'Write a comment…' : 'Login to comment…'}
                  disabled={!user || commentSubmitting}
                  className="w-full px-4 py-3 border rounded-lg dark:bg-gray-700 dark:text-white"
                  rows={3}
                  maxLength={1000}
                />
                <div className="flex items-center justify-end">
                  <button
                    onClick={submitComment}
                    disabled={!user || commentSubmitting}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {commentSubmitting ? 'Posting…' : 'Post Comment'}
                  </button>
                </div>
              </div>
              <div className="mt-6 space-y-4">
                {commentsLoading ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Loading comments…</p>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No comments yet. Be the first to comment.</p>
                ) : (
                  comments.map((c) => (
                    <div key={c._id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">
                          {c.user?.username ||
                            (c.user?.walletAddress
                              ? `${String(c.user.walletAddress).slice(0, 6)}…${String(c.user.walletAddress).slice(-4)}`
                              : 'Anonymous')}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}
                        </div>
                      </div>
                      <div className="mt-2 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                        {c.content}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              if (!user) {
                                showNotification('Please login to reply', 'warning');
                                return;
                              }
                              setReplyingTo(replyingTo === c._id ? null : c._id);
                              setReplyText('');
                            }}
                            className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
                          >
                            Reply
                          </button>
                        </div>
                        <button
                          onClick={async () => {
                            if (!user) {
                              showNotification('Please login to like comments', 'warning');
                              return;
                            }
                            try {
                              await api.post(`/comments/market/${c._id}/like`);
                              await fetchComments();
                            } catch (e) {
                              showNotification(e?.response?.data?.message || 'Failed to like comment', 'error');
                            }
                          }}
                          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path d="M2 10.5A2.5 2.5 0 014.5 8H7V4.5A2.5 2.5 0 019.5 2 1.5 1.5 0 0111 3.5V7h3.764a2.5 2.5 0 012.47 2.93l-1.2 6A2.5 2.5 0 0113.57 18H6a2 2 0 01-2-2v-5.5z" />
                          </svg>
                          <span>{Array.isArray(c.likes) ? c.likes.length : c.likeCount || 0}</span>
                        </button>
                      </div>
                      {replyingTo === c._id && (
                        <div className="mt-3 space-y-2">
                          <textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="Write a reply…"
                            disabled={commentSubmitting}
                            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                            rows={2}
                            maxLength={1000}
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setReplyingTo(null);
                                setReplyText('');
                              }}
                              disabled={commentSubmitting}
                              className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => submitReply(c._id)}
                              disabled={commentSubmitting}
                              className="px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                            >
                              {commentSubmitting ? 'Posting…' : 'Post Reply'}
                            </button>
                          </div>
                        </div>
                      )}
                      {Array.isArray(c.replies) && c.replies.length > 0 && (
                        <div className="mt-4 space-y-3 pl-4 border-l border-gray-200 dark:border-gray-700">
                          {c.replies.map((r) => (
                            <div key={r._id} className="rounded-lg p-3 bg-gray-50 dark:bg-gray-900/40">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                  {r.user?.username ||
                                    (r.user?.walletAddress
                                      ? `${String(r.user.walletAddress).slice(0, 6)}…${String(r.user.walletAddress).slice(-4)}`
                                      : 'Anonymous')}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  {r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}
                                </div>
                              </div>
                              <div className="mt-2 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap">
                                {r.content}
                              </div>
                              <div className="mt-2 flex justify-end">
                                <button
                                  onClick={async () => {
                                    if (!user) {
                                      showNotification('Please login to like comments', 'warning');
                                      return;
                                    }
                                    try {
                                      await api.post(`/comments/market/${r._id}/like`);
                                      await fetchComments();
                                    } catch (e) {
                                      showNotification(e?.response?.data?.message || 'Failed to like comment', 'error');
                                    }
                                  }}
                                  className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
                                >
                                  <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    className="h-4 w-4"
                                    viewBox="0 0 20 20"
                                    fill="currentColor"
                                  >
                                    <path d="M2 10.5A2.5 2.5 0 014.5 8H7V4.5A2.5 2.5 0 019.5 2 1.5 1.5 0 0111 3.5V7h3.764a2.5 2.5 0 012.47 2.93l-1.2 6A2.5 2.5 0 0113.57 18H6a2 2 0 01-2-2v-5.5z" />
                                  </svg>
                                  <span>{Array.isArray(r.likes) ? r.likes.length : r.likeCount || 0}</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* 2. Sidebar - second on mobile */}
          <aside className="order-2 md:col-span-1 md:sticky md:top-24 md:self-start h-fit">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
              {/* Check if resolved */}
              {itemData.isResolved || itemData.status === 'settled' || itemData.status === 'completed' ? (
                // Show only Holdings when resolved
                <>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                    Your Holdings
                  </h2>
                  {user && (
                    <div className="space-y-4 text-sm min-h-[4rem]">
                      {orderbookPositionsLoading && !positionsEverLoadedRef.current ? (
                        <div className="text-gray-500 dark:text-gray-400 py-4">Loading holdings…</div>
                      ) : holdingsWithShares.length === 0 ? (
                        <p className="text-gray-500 dark:text-gray-400 py-2">No open positions on this market.</p>
                      ) : (
                        <>
                          {holdingsWithShares.map((row) => {
                            const yesShares = row.YES?.shares || 0;
                            const noShares = row.NO?.shares || 0;
                            const yesRedeem = redeemableByPositionKey[`${row.optionKey}|YES`] || 0;
                            const noRedeem = redeemableByPositionKey[`${row.optionKey}|NO`] || 0;
                            return (
                              <div key={row.optionKey} className="space-y-2 pb-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
                                <div className="text-sm font-semibold text-gray-900 dark:text-white">{row.label}</div>
                                <table className="w-full text-sm border-0">
                                  <tbody className="text-gray-700 dark:text-gray-200">
                                    {yesShares > 1e-9 && (
                                      <tr>
                                        <td className="py-1.5 pr-4 text-gray-500 dark:text-gray-400">YES shares</td>
                                        <td className="py-1.5 text-right tabular-nums font-medium">{Number(yesShares).toFixed(4)}</td>
                                      </tr>
                                    )}
                                    {noShares > 1e-9 && (
                                      <tr>
                                        <td className="py-1.5 pr-4 text-gray-500 dark:text-gray-400">NO shares</td>
                                        <td className="py-1.5 text-right tabular-nums font-medium">{Number(noShares).toFixed(4)}</td>
                                      </tr>
                                    )}
                                    {(yesRedeem > 0 || noRedeem > 0) && (
                                      <tr>
                                        <td className="py-1.5 pr-4 text-gray-500 dark:text-gray-400 pt-1">Redeemable</td>
                                        <td className="py-1.5 text-right tabular-nums font-medium pt-1">
                                          {formatUsdAmount(yesRedeem + noRedeem)}
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            );
                          })}
                          <div className="flex justify-between pt-2 text-sm border-t border-gray-200 dark:border-gray-700">
                            <span className="text-gray-500 dark:text-gray-400">Total value</span>
                            <span className="font-semibold text-gray-900 dark:text-white tabular-nums">
                              {formatUsdAmount(orderbookHoldingsTotal)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  
                  {/* Resolved State - Claim buttons */}
                  {isResolved && (
                    <div className="mt-4">
                      {hasWon ? (
                        winningPredictions.map((pred, idx) => {
                          if (pred.claimed) {
                            return (
                              <div key={idx} className="mb-2 p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                                <p className="text-sm text-gray-600 dark:text-gray-400">Reward claimed</p>
                                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                  {getDisplayOutcome(pred.outcome)}: {formatUsdAmount(pred.payout || 0)}
                                </p>
                              </div>
                            );
                          }
                          return (
                            <button
                              key={idx}
                              onClick={async () => {
                                try {
                                  if (!itemData.marketId) {
                                    showNotification('Market not found', 'error');
                                    return;
                                  }
                                  let linked;
                                  try {
                                    linked = await ensureLinkedWallet();
                                  } catch (e) {
                                    if (String(e?.message || '') === 'WALLET_IN_USE') return;
                                    showNotification('Connect your wallet (same as on your profile)', 'warning');
                                    return;
                                  }

                                  const { data: auth } = await api.post(`/predictions/${pred._id}/claim-authorization`, {
                                    walletAddress: linked,
                                  });

                                  // Gas-drip before claim if user has no Base ETH for gas.
                                  const okGas = await ensureGasOrDrip(linked, { label: 'claim' });
                                  if (!okGas) return;

                                  const txHash =
                                    auth.claimKind === 'orderbook'
                                      ? await claimOrderbookPositionWithAuth(
                                          auth.marketId,
                                          auth.amountWei,
                                          auth.positionKey,
                                          auth.predictionId,
                                          auth.deadline,
                                          auth.signature
                                        )
                                      : await claimPredictionWinsWithAuth(
                                          auth.marketId,
                                          auth.isBoost,
                                          auth.amountWei,
                                          auth.predictionId,
                                          auth.deadline,
                                          auth.signature
                                        );
                                  showNotification(`Claim sent to blockchain! TX: ${txHash.slice(0, 10)}...`, 'success');

                                  try {
                                    await api.post('/transactions', {
                                      action: auth.claimKind === 'boost' ? 'boost_claim' : 'market_claim',
                                      txHash,
                                      amount: parseFloat(unitsToUsdc(auth.amountWei)),
                                      currency: 'USDC',
                                      itemType: isPoll ? 'poll' : 'match',
                                      itemId: itemData._id,
                                      meta: { predictionId: String(pred._id) },
                                    });
                                  } catch {
                                    // ignore
                                  }

                                  await api.post(`/predictions/${pred._id}/claim`);
                                  showNotification('Payout claimed successfully!', 'success');
                                  fetchUserMarketPrediction();
                                } catch (error) {
                                  console.error('Error claiming:', error);
                                  const msg =
                                    error?.response?.data?.message ||
                                    getBlockchainErrorMessage(error) ||
                                    error.message ||
                                    'Failed to claim';
                                  showNotification(msg, 'error');
                                }
                              }}
                              className="w-full mb-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                            >
                              Claim {getDisplayOutcome(pred.outcome)}: {formatUsdAmount(pred.payout || 0)}
                            </button>
                          );
                        })
                      ) : (
                        <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-lg">
                          <p className="text-sm text-gray-600 dark:text-gray-400">You did not win this prediction</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                // Show full trading UI when not resolved
                <>
                  <div className="border-b border-slate-200 dark:border-slate-700 pb-4 mb-4">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Trade</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {selectedOption
                        ? `${outcomeRows.find((r) => r.key === selectedOption)?.label || selectedOption} · ${selectedSide}`
                        : 'Select an outcome in Markets'}
                    </p>
                  </div>

                  <OrderbookTradePanel
                    itemData={itemData}
                    isPoll={isPoll}
                    matchId={!isPoll ? itemData._id : undefined}
                    pollId={isPoll ? itemData._id : undefined}
                    user={user}
                    account={account}
                    ensureLinkedWallet={ensureLinkedWallet}
                    showNotification={showNotification}
                    locked={locked}
                    vaultRefreshNonce={vaultRefreshNonce}
                    selectedOptionKey={selectedOption || undefined}
                    selectedSide={selectedSide}
                    onChangeOptionKey={(k) => setSelectedOption(k)}
                    onChangeSide={(s) => setSelectedSide(s)}
                    hideOutcomeSelector={true}
                    onOrderPlaced={async (result) => {
                      const order = result?.order || result;
                      const filled = Number(order?.sizeFilled) || 0;
                      const st = String(order?.status || '').toLowerCase();
                      if (st === 'filled' || filled > 0) {
                        showNotification(
                          filled > 0
                            ? `Trade executed: ${filled.toFixed(4)} shares filled — see Positions`
                            : 'Order filled — see Positions',
                          'success'
                        );
                      }
                      await Promise.all([
                        fetchTradingPanel({ silent: true, force: true }),
                        fetchAllOptionBooks({ force: true }),
                        fetchOrderbookActivity(),
                      ]);
                      try {
                        const itemResponse = isPoll
                          ? await api.get(`/polls/${itemData._id}`)
                          : await api.get(`/matches/${itemData._id}`);
                        setCurrentItem(itemResponse.data);
                        if (onItemUpdate) onItemUpdate(itemResponse.data);
                      } catch {
                        /* best-effort pause flag refresh */
                      }
                      if (expandedOption) await fetchOptionBooks(expandedOption);
                    }}
                  />

                  {false && (
                    <>
                  {/* Trade Type Toggle */}
                  <div className="flex mb-4 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                <button
                  onClick={() => setTradeType('buy')}
                  className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    tradeType === 'buy'
                      ? 'bg-green-500 text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  Buy
                </button>
                <button
                  onClick={() => setTradeType('sell')}
                  className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    tradeType === 'sell'
                      ? 'bg-red-500 text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  Sell
                </button>
              </div>

              {/* Option Selection */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select Option
                </label>
                {selectedOption && (() => {
                  // Get current price for selected option
                  let currentPrice = 0;
                  if (isPoll) {
                    if (itemData.optionType === 'options' && itemData.options) {
                      currentPrice = prices[selectedOption] || 0;
                    } else {
                      currentPrice = selectedOption.toLowerCase() === 'yes' ? (prices.yes || 0) : (prices.no || 0);
                    }
                  } else {
                    if (selectedOption === 'teamA') currentPrice = prices.teamA || 0;
                    else if (selectedOption === 'teamB') currentPrice = prices.teamB || 0;
                    else if (selectedOption === 'draw') currentPrice = prices.draw || 0;
                  }
                  return currentPrice > 0 && (
                    <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Current Price:{' '}
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          {formatUsdAmount(currentPrice)} / share
                        </span>
                      </p>
                    </div>
                  );
                })()}
                {isPoll ? (
                  itemData.optionType === 'options' && itemData.options ? (
                    <div className="grid grid-cols-1 gap-2">
                      {itemData.options.map((opt, idx) => {
                        const optPrice = prices[opt.text] || 0;
                        return (
                          <button
                            key={idx}
                            onClick={() => {
                              if (!locked) {
                                setSelectedOption(opt.text);
                              }
                            }}
                            disabled={locked}
                            className={`px-4 py-3 rounded-lg font-semibold transition-colors flex items-center gap-3 ${
                              locked
                                ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                                : selectedOption === opt.text
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            {opt.image && (
                              <img src={opt.image} alt={opt.text} className="w-10 h-10 object-cover rounded-full" />
                            )}
                            <div className="flex-1 text-left">
                              <div>{opt.text}</div>
                              <div className="text-xs mt-1">{(optPrice * 100).toFixed(1)}%</div>
                              <div className="text-xs mt-0.5 font-semibold">{formatUsdAmount(priceAmounts[opt.text] || 0)}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          if (!locked) {
                            setSelectedOption('yes');
                          }
                        }}
                        disabled={locked}
                        className={`px-4 py-3 rounded-lg font-semibold transition-colors ${
                          locked
                            ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                            : selectedOption === 'yes'
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        YES
                        <div className="text-xs mt-1">{(prices.yes * 100).toFixed(1)}%</div>
                        <div className="text-xs mt-0.5 font-semibold">{formatUsdAmount(priceAmounts.yes || 0)}</div>
                      </button>
                      <button
                        onClick={() => {
                          if (!locked) {
                            setSelectedOption('no');
                          }
                        }}
                        disabled={locked}
                        className={`px-4 py-3 rounded-lg font-semibold transition-colors ${
                          locked
                            ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                            : selectedOption === 'no'
                            ? 'bg-red-500 text-white'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        NO
                        <div className="text-xs mt-1">{(prices.no * 100).toFixed(1)}%</div>
                        <div className="text-xs mt-0.5 font-semibold">{formatUsdAmount(priceAmounts.no || 0)}</div>
                      </button>
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => {
                        if (!locked) {
                          setSelectedOption('teamA');
                        }
                      }}
                      disabled={locked}
                      className={`px-3 py-3 rounded-lg font-semibold transition-colors text-sm flex flex-col items-center ${
                        locked
                          ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                          : selectedOption === 'teamA'
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                      title={`${itemData.teamA} Win`}
                    >
                      {itemData.teamAImage && (
                        <img src={itemData.teamAImage} alt={itemData.teamA} className="w-8 h-8 object-cover rounded-full mb-1" />
                      )}
                      <div className="truncate text-xs">{itemData.teamA}</div>
                      <div className="text-xs mt-1">{(prices.teamA * 100).toFixed(1)}%</div>
                      <div className="text-xs mt-0.5 font-semibold">{formatUsdAmount(priceAmounts.teamA || 0)}</div>
                    </button>
                    <button
                      onClick={() => {
                        if (!locked) {
                          setSelectedOption('draw');
                        }
                      }}
                      disabled={locked}
                      className={`px-3 py-3 rounded-lg font-semibold transition-colors text-sm ${
                        locked
                          ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                          : selectedOption === 'draw'
                          ? 'bg-purple-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      Draw
                      <div className="text-xs mt-1">{(prices.draw * 100).toFixed(1)}%</div>
                      <div className="text-xs mt-0.5 font-semibold">{formatUsdAmount(priceAmounts.draw || 0)}</div>
                    </button>
                    <button
                      onClick={() => {
                        if (!locked) {
                          setSelectedOption('teamB');
                        }
                      }}
                      disabled={locked}
                      className={`px-3 py-3 rounded-lg font-semibold transition-colors text-sm flex flex-col items-center ${
                        locked
                          ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                          : selectedOption === 'teamB'
                          ? 'bg-red-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                      title={`${itemData.teamB} Win`}
                    >
                      {itemData.teamBImage && (
                        <img src={itemData.teamBImage} alt={itemData.teamB} className="w-8 h-8 object-cover rounded-full mb-1" />
                      )}
                      <div className="truncate text-xs">{itemData.teamB}</div>
                      <div className="text-xs mt-1">{(prices.teamB * 100).toFixed(1)}%</div>
                      <div className="text-xs mt-0.5 font-semibold">{formatUsdAmount(priceAmounts.teamB || 0)}</div>
                    </button>
                  </div>
                )}
              </div>

              {/* Amount Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {tradeType === 'buy' ? 'Amount (USDC)' : 'Shares to Sell'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step={tradeType === 'buy' ? "0.01" : "0.0001"}
                    min="0"
                    max={tradeType === 'sell' && selectedOption ? (() => {
                      // Find the prediction for this option
                      let optionPrediction = predictions[selectedOption];
                      if (!optionPrediction) {
                        optionPrediction = predictions[selectedOption.toUpperCase()] || 
                                         predictions[selectedOption.toLowerCase()] ||
                                         predictions[selectedOption.charAt(0).toUpperCase() + selectedOption.slice(1).toLowerCase()];
                      }
                      if (!optionPrediction && !isPoll) {
                        const normalized = selectedOption === 'teamA' ? 'TEAMA' : 
                                          selectedOption === 'teamB' ? 'TEAMB' : 
                                          selectedOption === 'draw' ? 'DRAW' : selectedOption.toUpperCase();
                        optionPrediction = predictions[normalized];
                      }
                      return optionPrediction?.shares || 0;
                    })() : undefined}
                    value={amount}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (tradeType === 'sell') {
                        // Find the prediction for this option
                        let optionPrediction = predictions[selectedOption];
                        if (!optionPrediction) {
                          optionPrediction = predictions[selectedOption.toUpperCase()] || 
                                           predictions[selectedOption.toLowerCase()] ||
                                           predictions[selectedOption.charAt(0).toUpperCase() + selectedOption.slice(1).toLowerCase()];
                        }
                        if (!optionPrediction && !isPoll) {
                          const normalized = selectedOption === 'teamA' ? 'TEAMA' : 
                                            selectedOption === 'teamB' ? 'TEAMB' : 
                                            selectedOption === 'draw' ? 'DRAW' : selectedOption.toUpperCase();
                          optionPrediction = predictions[normalized];
                        }
                        const maxShares = optionPrediction?.shares || 0;
                        const inputValue = parseFloat(value);
                        if (!isNaN(inputValue) && inputValue > maxShares) {
                          // Don't allow more than max
                          setAmount(maxShares.toFixed(4));
                        } else {
                          setAmount(value);
                        }
                      } else {
                        setAmount(value);
                      }
                    }}
                    disabled={locked}
                    className={`flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white ${
                      locked ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                    placeholder={tradeType === 'buy' ? "0.0" : "0"}
                  />
                  {tradeType === 'sell' && selectedOption && (() => {
                    // Find the prediction for this option (try multiple variations)
                    let optionPrediction = predictions[selectedOption];
                    if (!optionPrediction) {
                      optionPrediction = predictions[selectedOption.toUpperCase()] ||
                                       predictions[selectedOption.toLowerCase()] ||
                                       predictions[selectedOption.charAt(0).toUpperCase() + selectedOption.slice(1).toLowerCase()];
                    }
                    if (!optionPrediction && !isPoll) {
                      const normalized = selectedOption === 'teamA' ? 'TEAMA' :
                                        selectedOption === 'teamB' ? 'TEAMB' :
                                        selectedOption === 'draw' ? 'DRAW' : selectedOption.toUpperCase();
                      optionPrediction = predictions[normalized];
                    }
                    const availableShares = optionPrediction?.shares || 0;
                    return availableShares > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!locked) {
                            setAmount(availableShares.toFixed(4));
                          }
                        }}
                        disabled={locked}
                        className={`px-3 py-2 rounded-lg text-sm ${
                          locked
                            ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                        }`}
                      >
                        Max
                      </button>
                    );
                  })()}
                </div>
                {tradeType === 'buy' ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {formatUsdAmount(amount || 0)}
                  </p>
                ) : null}
                {tradeType === 'buy' && selectedOption && amount && (() => {
                  // Get current price for selected option
                  let currentPrice = 0;
                  if (isPoll) {
                    if (itemData.optionType === 'options' && itemData.options) {
                      currentPrice = prices[selectedOption] || 0;
                    } else {
                      currentPrice = selectedOption.toLowerCase() === 'yes' ? (prices.yes || 0) : (prices.no || 0);
                    }
                  } else {
                    if (selectedOption === 'teamA') currentPrice = prices.teamA || 0;
                    else if (selectedOption === 'teamB') currentPrice = prices.teamB || 0;
                    else if (selectedOption === 'draw') currentPrice = prices.draw || 0;
                  }
                  const ethAmount = parseFloat(amount) || 0;
                  const estimatedShares = currentPrice > 0 ? (ethAmount / currentPrice) : 0;
                  return ethAmount > 0 && currentPrice > 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      You&apos;ll receive ~<span className="font-semibold">{estimatedShares.toFixed(4)}</span> shares at {formatUsdAmount(currentPrice)} / share
                      {` · spend ${formatUsdAmount(ethAmount)}`}
                    </p>
                  );
                })()}
                {tradeType === 'sell' && selectedOption && (() => {
                  // Find the prediction for this option (try multiple variations)
                  let optionPrediction = predictions[selectedOption];
                  if (!optionPrediction) {
                    optionPrediction = predictions[selectedOption.toUpperCase()] || 
                                     predictions[selectedOption.toLowerCase()] ||
                                     predictions[selectedOption.charAt(0).toUpperCase() + selectedOption.slice(1).toLowerCase()];
                  }
                  // For matches, also try normalized versions
                  if (!optionPrediction && !isPoll) {
                    const normalized = selectedOption === 'teamA' ? 'TEAMA' : 
                                      selectedOption === 'teamB' ? 'TEAMB' : 
                                      selectedOption === 'draw' ? 'DRAW' : selectedOption.toUpperCase();
                    optionPrediction = predictions[normalized];
                  }
                  const availableShares = optionPrediction?.shares || 0;
                  
                  // Calculate equivalent payout amount if user entered shares-to-sell
                  let equivalentETH = 0;
                  if (amount && amount !== 'max' && amount !== 'all') {
                    const sharesToSell = parseFloat(amount);
                    if (!isNaN(sharesToSell) && sharesToSell > 0 && availableShares > 0) {
                      // Use current price: payout = shares * currentPrice
                      let currentPrice = 0;
                      if (isPoll) {
                        if (itemData.optionType === 'options' && itemData.options) {
                          currentPrice = prices[selectedOption] || 0;
                        } else {
                          currentPrice = selectedOption.toLowerCase() === 'yes' ? (prices.yes || 0) : (prices.no || 0);
                        }
                      } else {
                        if (selectedOption === 'teamA') currentPrice = prices.teamA || 0;
                        else if (selectedOption === 'teamB') currentPrice = prices.teamB || 0;
                        else if (selectedOption === 'draw') currentPrice = prices.draw || 0;
                      }
                      
                      if (currentPrice > 0) {
                        equivalentETH = sharesToSell * currentPrice;
                      }
                    }
                  }
                  
                  return (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 space-y-1">
                      <p>Available: {availableShares.toFixed(4)} shares</p>
                      {amount && amount !== 'max' && amount !== 'all' && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && equivalentETH > 0 && (
                        <p className="font-semibold text-gray-700 dark:text-gray-300">
                          You&apos;ll receive ≈ {formatUsdAmount(equivalentETH)}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Trade Button */}
              <button
                onClick={handleTrade}
                disabled={(() => {
                  if (locked) return true;
                  if (tradeType === 'buy') {
                    return !selectedOption || !amount;
                  } else {
                    // For sell, check holdings for selected option
                    if (!selectedOption || !amount) return true;
                    
                    // Find the prediction for this option (try multiple variations)
                    let optionPrediction = predictions[selectedOption];
                    if (!optionPrediction) {
                      optionPrediction = predictions[selectedOption.toUpperCase()] || 
                                       predictions[selectedOption.toLowerCase()] ||
                                       predictions[selectedOption.charAt(0).toUpperCase() + selectedOption.slice(1).toLowerCase()];
                    }
                    // For matches, also try normalized versions
                    if (!optionPrediction && !isPoll) {
                      const normalized = selectedOption === 'teamA' ? 'TEAMA' : 
                                        selectedOption === 'teamB' ? 'TEAMB' : 
                                        selectedOption === 'draw' ? 'DRAW' : selectedOption.toUpperCase();
                      optionPrediction = predictions[normalized];
                    }
                    
                    const availableShares = optionPrediction?.shares || 0;
                    if (availableShares <= 0) return true;
                    if (amount !== 'max' && amount !== 'all') {
                      const parsedAmount = parseFloat(amount);
                      if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > availableShares) return true;
                    }
                    return false;
                  }
                })()}
                className={`w-full px-4 py-3 rounded-lg font-semibold transition-colors ${
                  locked
                    ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                    : tradeType === 'buy'
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {tradeType === 'buy' ? 'Buy' : 'Sell'}{' '}
                {tradeType === 'buy' ? (
                  selectedOption === 'yes' ? 'YES' :
                  selectedOption === 'no' ? 'NO' :
                  selectedOption === 'teamA' ? itemData.teamA :
                  selectedOption === 'teamB' ? itemData.teamB :
                  selectedOption === 'draw' ? 'Draw' :
                  isPoll && itemData.optionType === 'options' ? selectedOption : ''
                ) : (
                  selectedOption === 'yes' ? 'YES' :
                  selectedOption === 'no' ? 'NO' :
                  selectedOption === 'teamA' ? itemData.teamA :
                  selectedOption === 'teamB' ? itemData.teamB :
                  selectedOption === 'draw' ? 'Draw' :
                  isPoll && itemData.optionType === 'options' ? selectedOption : 'Shares'
                )}
              </button>
                    </>
                  )}

                  {/* User Holdings */}
                  {user && (
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 min-h-[4rem]">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Your holdings</h3>
                      {orderbookPositionsLoading && !positionsEverLoadedRef.current ? (
                        <p className="text-gray-500 dark:text-gray-400 text-sm">Loading…</p>
                      ) : holdingsWithShares.length === 0 ? (
                        <p className="text-gray-500 dark:text-gray-400 text-sm">No positions yet.</p>
                      ) : (
                        <div className="space-y-4 text-sm">
                          {holdingsWithShares.map((row) => {
                            const yesShares = row.YES?.shares || 0;
                            const noShares = row.NO?.shares || 0;
                            return (
                              <div key={row.optionKey} className="pb-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                                <div className="text-sm font-semibold text-gray-900 dark:text-white truncate mb-1">{row.label}</div>
                                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                                  <span>YES</span>
                                  <span className="tabular-nums font-medium">{yesShares > 1e-9 ? Number(yesShares).toFixed(4) : '—'}</span>
                                </div>
                                <div className="flex justify-between text-gray-600 dark:text-gray-300">
                                  <span>NO</span>
                                  <span className="tabular-nums font-medium">{noShares > 1e-9 ? Number(noShares).toFixed(4) : '—'}</span>
                                </div>
                              </div>
                            );
                          })}
                          <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
                            <span className="text-gray-500 dark:text-gray-400">Total</span>
                            <span className="font-semibold tabular-nums">{formatUsdAmount(orderbookHoldingsTotal)}</span>
                          </div>
                          {!isResolved && orderbookHoldingsPotentialWinTotal > 1e-6 && (
                            <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
                              <span className="text-gray-500 dark:text-gray-400">Total potential win</span>
                              <span className="font-semibold tabular-nums">
                                {formatUsdAmount(orderbookHoldingsPotentialWinTotal)}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default MatchDetail;
