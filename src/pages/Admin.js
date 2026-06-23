import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useNotification } from '../components/Notification';
import {
  createMarket,
  addLiquidity,
  batchAddOrderbookLiquidity,
  resolveMarket,
  updateMarketStatus,
  ensureUsdcAllowance,
  usdcToUnits,
  isOnChainAdmin,
  getBlockchainErrorMessage,
} from '../utils/blockchain';
import Modal from '../components/Modal';
import TargetOddsInputs from '../components/TargetOddsInputs';
import { evenPctSplit, startingPricesFromPctRows, distributeEvenlyWithBalance } from '../utils/targetOdds';
import TiptapEditor from '../components/TiptapEditor';
import ImageUpload from '../components/ImageUpload';
import { formatUsdAmount } from '../utils/money';
import { utcDatetimeLocalToIso, utcIsoToDatetimeLocal, formatEventDateGmt } from '../utils/eventDate';
// USDC ~ USD; show $ directly (no ETH conversion hints)

const ITEMS_PER_PAGE = 20;

/** Format 0–1 price for starting-price inputs (2 decimal places). */
function formatStartingPrice(n) {
  const v = Math.max(0, Math.min(1, Number(n) || 0));
  return String(Math.round(v * 100) / 100);
}

/** Complementary side so YES + NO = 1 per outcome. */
function complementaryStartingPrice(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return formatStartingPrice(1 - Math.max(0, Math.min(1, n)));
}

const AdminPoolModal = ({ kind, item, poolType, onClose }) => {
  const { showNotification } = useNotification();
  const [pool, setPool] = useState(0);
  const [amount, setAmount] = useState('');
  const [action, setAction] = useState('add');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const base = kind === 'match' ? 'matches' : 'polls';
  const path = poolType === 'jackpot' ? 'jackpot-pool' : 'boost-pool';
  const title = poolType === 'jackpot' ? 'Jackpot pool' : 'Boost pool';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/admin/${base}/${item._id}/${path}`);
        if (!cancelled) setPool(data.pool || 0);
      } catch (e) {
        if (!cancelled) showNotification(e.response?.data?.message || 'Failed to load pool', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [item._id, base, path, showNotification]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (Number.isNaN(amt) || amt <= 0) {
      showNotification('Enter a valid amount', 'warning');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/admin/${base}/${item._id}/${path}`, { action, amount: amt });
      setPool(data.freeJackpotPool ?? data.boostPool ?? data.pool ?? pool);
      showNotification('Pool updated', 'success');
      onClose(true);
    } catch (e) {
      showNotification(e.response?.data?.message || 'Update failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={() => onClose(false)} title={`${title} — ${item.label || item.teamA || item.question || ''}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Current: {loading ? '…' : formatUsdAmount(pool)}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setAction('add')} className={`flex-1 py-2 rounded-lg border ${action === 'add' ? 'bg-blue-600 text-white border-blue-600' : ''}`}>Add</button>
          <button type="button" onClick={() => setAction('subtract')} className={`flex-1 py-2 rounded-lg border ${action === 'subtract' ? 'bg-rose-600 text-white border-rose-600' : ''}`}>Subtract</button>
        </div>
        <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="USDC amount" className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white" required />
        <div className="flex gap-2">
          <button type="button" onClick={() => onClose(false)} className="flex-1 py-2 border rounded-lg">Cancel</button>
          <button type="submit" disabled={saving} className="flex-1 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">{saving ? '…' : 'Apply'}</button>
        </div>
      </form>
    </Modal>
  );
};

const Admin = () => {
  const [activeTab, setActiveTab] = useState('matches');
  const [matches, setMatches] = useState([]);
  const [cups, setCups] = useState([]);
  const [stages, setStages] = useState([]);
  const [polls, setPolls] = useState([]);
  const [blogs, setBlogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const { showNotification } = useNotification();

  const requireOnChainAdmin = useCallback(async () => {
    try {
      // If the ABI/contract doesn't support admins() yet, isOnChainAdmin returns false.
      const addr = await (async () => {
        if (typeof window === 'undefined' || typeof window.ethereum === 'undefined') return null;
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        return accounts && accounts.length ? accounts[0] : null;
      })();
      if (!addr) throw new Error('Connect MetaMask to continue');

      const ok = await isOnChainAdmin(addr);
      if (!ok) {
        throw new Error(
          `Your connected wallet (${addr.slice(0, 6)}…${addr.slice(-4)}) is not an on-chain admin. ` +
            'The contract function batchAddOrderbookLiquidity is onlyAdmin. ' +
            'Switch to the deployer wallet or call setAdmin(wallet,true) from the deployer to grant admin rights.'
        );
      }
      return addr;
    } catch (e) {
      throw e;
    }
  }, []);

  useEffect(() => {
    setTablePage(1);
  }, [activeTab]);
  
  useEffect(() => {
    import('../utils/syncChainConfig').then(({ syncChainConfigFromServer }) =>
      syncChainConfigFromServer().catch((e) => console.warn('chain config sync:', e?.message || e))
    );
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'matches') {
        const response = await api.get('/matches');
        setMatches(response.data || []);
      } else if (activeTab === 'cups') {
        const response = await api.get('/cups');
        setCups(response.data || []);
      } else if (activeTab === 'polls') {
        const response = await api.get('/polls');
        setPolls(response.data || []);
      } else if (activeTab === 'blogs') {
        const response = await api.get('/admin/blogs');
        setBlogs(response.data || []);
      } else if (activeTab === 'settings') {
        // Settings will be handled separately
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      showNotification(error.response?.data?.message || 'Error fetching data', 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTab, showNotification]);

  const fetchCups = useCallback(async () => {
    try {
      const response = await api.get('/cups');
      setCups(response.data);
    } catch (error) {
      console.error('Error fetching cups:', error);
    }
  }, []);

  const fetchStages = useCallback(async (cupsData) => {
    try {
      // Fetch stages for all cups
      const allStages = [];
      for (const cup of cupsData) {
        const response = await api.get(`/cups/${cup.slug}/stages`);
        allStages.push(...response.data);
      }
      setStages(allStages);
    } catch (error) {
      console.error('Error fetching stages:', error);
    }
  }, []);

  const fetchAllStages = useCallback(async () => {
    try {
      const response = await api.get('/stages');
      setStages(response.data);
    } catch (error) {
      console.error('Error fetching all stages:', error);
    }
  }, []);

  useEffect(() => {
    fetchData();
    if (activeTab === 'matches' || activeTab === 'polls' || activeTab === 'stages') {
      if (activeTab === 'stages') {
        fetchAllStages();
        fetchCups();
      } else {
        // For matches and polls, fetch cups first, then stages after cups are loaded
        fetchCups().then(() => {
          // This will be handled by the cups effect
        });
      }
    }
  }, [activeTab, fetchData, fetchAllStages, fetchCups]);

  // Separate effect to fetch stages when cups change (for matches/polls tabs)
  useEffect(() => {
    if ((activeTab === 'matches' || activeTab === 'polls') && cups.length > 0) {
      fetchStages(cups);
    }
  }, [cups, activeTab, fetchStages]);

  const handleCreateStage = async (stageData) => {
    try {
      await api.post('/admin/stages', stageData);
      fetchAllStages();
      showNotification('Stage created successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to create stage', 'error');
    }
  };

  const handleUpdateStage = async (stageId, updates) => {
    try {
      await api.put(`/stages/${stageId}`, updates);
      fetchAllStages();
      showNotification('Stage updated successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to update stage', 'error');
    }
  };

  const handleDeleteStage = async (stageId) => {
    try {
      await api.delete(`/stages/${stageId}`);
      fetchAllStages();
      showNotification('Stage deleted successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to delete stage', 'error');
    }
  };

  const handleCreateMatch = async (matchData) => {
    try {
      const { syncChainConfigFromServer } = await import('../utils/syncChainConfig');
      const { assertUsdcMatchesContract } = await import('../utils/blockchain');
      await syncChainConfigFromServer();
      await assertUsdcMatchesContract();
      // Orderbook seed liquidity is on-chain onlyAdmin
      await requireOnChainAdmin();

      // Create market on blockchain first (auto-connects wallet and switches network if needed)
      const options =
        matchData.drawEnabled === false ? ['TeamA', 'TeamB'] : ['TeamA', 'Draw', 'TeamB'];
      const marketId = await createMarket(false, options);
      const marketIdNum = parseInt(marketId, 10);
      showNotification(`Market created on blockchain! Market ID: ${marketIdNum}`, 'success');
      
      // Wait a moment to ensure the market is fully created on blockchain
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Add initial YES/NO liquidity (batched) if provided
      const seedRows = Array.isArray(matchData?.yesNo)
        ? matchData.yesNo
        : [
            { option: 'TeamA', yesAmount: matchData?.teamAYes || 0, noAmount: matchData?.teamANo || 0 },
            { option: 'TeamB', yesAmount: matchData?.teamBYes || 0, noAmount: matchData?.teamBNo || 0 },
            { option: 'Draw', yesAmount: matchData?.drawYes || 0, noAmount: matchData?.drawNo || 0 },
          ];
      const rows = seedRows
        .map((r) => ({
          option: String(r?.option || '').trim(),
          yesAmount: parseFloat(r?.yesAmount) || 0,
          noAmount: parseFloat(r?.noAmount) || 0,
        }))
        .filter((r) => r.option && (r.yesAmount > 0 || r.noAmount > 0))
        .filter((r) => matchData.drawEnabled !== false || r.option !== 'Draw');

      if (rows.length > 0) {
        let total = 0n;
        for (const r of rows) total += usdcToUnits(r.yesAmount) + usdcToUnits(r.noAmount);
        if (total > 0n) await ensureUsdcAllowance(total);
        await batchAddOrderbookLiquidity(marketIdNum, rows);
        showNotification('Initial YES/NO liquidity added on blockchain!', 'success');
      }
      
      // Create match in backend with marketId
      await api.post('/admin/matches', {
        ...matchData,
        marketId: marketIdNum,
        marketInitialized: rows.length > 0,
      });
      
      fetchData();
      showNotification('Match created successfully on blockchain and backend!', 'success');
    } catch (error) {
      console.error('Error creating match:', error);
      showNotification(getBlockchainErrorMessage(error) || error.message || 'Failed to create match', 'error');
    }
  };

  const handleUpdateMatch = async (matchId, updates) => {
    try {
      await api.put(`/admin/matches/${matchId}`, updates);
      fetchData();
      showNotification('Match updated successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to update match', 'error');
    }
  };

  const handleDeleteMatch = async (matchId) => {
    try {
      await api.delete(`/admin/matches/${matchId}`);
      fetchData();
      showNotification('Match deleted successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to delete match', 'error');
    }
  };

  const handleAddMatchLiquidity = async (matchId, liquidity) => {
    try {
      // Auto-connects wallet and switches network if needed
      // Get match to get marketId
      const matchResponse = await api.get(`/matches/${matchId}`);
      const match = matchResponse.data;
      
      if (!match.marketId) {
        showNotification('Market not created on blockchain yet', 'error');
        return;
      }
      
      // Add liquidity on blockchain first
      try {
        const rows = [
          { option: 'TeamA', yesAmount: liquidity.teamAYes || 0, noAmount: liquidity.teamANo || 0 },
          { option: 'TeamB', yesAmount: liquidity.teamBYes || 0, noAmount: liquidity.teamBNo || 0 },
          { option: 'Draw', yesAmount: liquidity.drawYes || 0, noAmount: liquidity.drawNo || 0 },
        ].filter((r) => (parseFloat(r.yesAmount) || 0) + (parseFloat(r.noAmount) || 0) > 0);

        if (rows.length > 0) {
          let total = 0n;
          for (const r of rows) {
            total += usdcToUnits(r.yesAmount) + usdcToUnits(r.noAmount);
          }
          if (total > 0n) await ensureUsdcAllowance(total);
          await batchAddOrderbookLiquidity(match.marketId, rows);
        }

        const legacy = {
          teamALiquidity:
            (parseFloat(liquidity.teamAYes) || 0) +
            (parseFloat(liquidity.teamANo) || 0) +
            (parseFloat(liquidity.teamALiquidity) || 0),
          teamBLiquidity:
            (parseFloat(liquidity.teamBYes) || 0) +
            (parseFloat(liquidity.teamBNo) || 0) +
            (parseFloat(liquidity.teamBLiquidity) || 0),
          drawLiquidity:
            (parseFloat(liquidity.drawYes) || 0) +
            (parseFloat(liquidity.drawNo) || 0) +
            (parseFloat(liquidity.drawLiquidity) || 0),
          yesNo: rows,
        };

        showNotification('Liquidity added on blockchain!', 'success');
        
        // Update backend only after blockchain success
        await api.post(`/admin/matches/${matchId}/liquidity`, legacy);
      } catch (blockchainError) {
        console.error('Blockchain transaction failed:', blockchainError);
        showNotification(blockchainError.message || 'Blockchain transaction failed. Please try again.', 'error');
        throw blockchainError; // Re-throw to prevent backend call
      }
      fetchData();
      showNotification('Liquidity added successfully!', 'success');
    } catch (error) {
      console.error('Error adding liquidity:', error);
      showNotification(error.message || 'Failed to add liquidity', 'error');
    }
  };

  const handleResolveMatch = async (matchId, result) => {
    try {
      // Auto-connects wallet and switches network if needed
      // Get match to get marketId
      const matchResponse = await api.get(`/matches/${matchId}`);
      const match = matchResponse.data;
      
      if (!match.marketId) {
        showNotification('Market not created on blockchain yet', 'error');
        return;
      }
      
      // Map result to blockchain format
      let winningOption = result;
      if (result === 'TeamA' || result.toLowerCase() === 'teama') {
        winningOption = 'TeamA';
      } else if (result === 'TeamB' || result.toLowerCase() === 'teamb') {
        winningOption = 'TeamB';
      } else if (result === 'Draw' || result.toLowerCase() === 'draw') {
        winningOption = 'Draw';
      }
      
      // Resolve on blockchain first
      try {
        const txHash = await resolveMarket(match.marketId, winningOption);
        showNotification(`Match resolved on blockchain! TX: ${txHash.slice(0, 10)}...`, 'success');
        
        // Resolve in backend (payouts recorded in DB; users claim via signed txs — no per-user on-chain sync)
        await api.post(`/admin/matches/${matchId}/resolve`, { result });
      } catch (blockchainError) {
        console.error('Blockchain transaction failed:', blockchainError);
        showNotification(blockchainError.message || 'Blockchain transaction failed. Please try again.', 'error');
        throw blockchainError; // Re-throw to prevent backend call
      }
      fetchData();
      showNotification('Match resolved successfully!', 'success');
    } catch (error) {
      console.error('Error resolving match:', error);
      showNotification(error.message || 'Failed to resolve match', 'error');
    }
  };

  const handleCreatePoll = async (pollData) => {
    try {
      const { syncChainConfigFromServer } = await import('../utils/syncChainConfig');
      const { assertUsdcMatchesContract } = await import('../utils/blockchain');
      await syncChainConfigFromServer();
      await assertUsdcMatchesContract();
      // Orderbook seed liquidity is on-chain onlyAdmin
      await requireOnChainAdmin();

      // Auto-connects wallet and switches network if needed
      // Create market on blockchain first
      // Polls are ALWAYS option-based now (no default YES/NO poll)
      const options = (pollData?.options || []).map((opt) => String(opt?.text || '').trim()).filter(Boolean);
      if (options.length === 0) {
        showNotification('Add at least 1 poll option', 'warning');
        return;
      }
      
      const marketId = await createMarket(true, options);
      const marketIdNum = parseInt(marketId, 10);
      showNotification(`Market created on blockchain! Market ID: ${marketIdNum}`, 'success');
      
      // Wait a moment to ensure the market is fully created on blockchain
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Add initial YES/NO liquidity per option (batched)
      const rows = (pollData?.options || [])
        .map((opt) => ({
          option: String(opt?.text || '').trim(),
          yesAmount: parseFloat(opt?.yesLiquidity) || 0,
          noAmount: parseFloat(opt?.noLiquidity) || 0,
        }))
        .filter((r) => r.option && (r.yesAmount > 0 || r.noAmount > 0));

      if (rows.length > 0) {
        let total = 0n;
        for (const r of rows) total += usdcToUnits(r.yesAmount) + usdcToUnits(r.noAmount);
        if (total > 0n) await ensureUsdcAllowance(total);
        await batchAddOrderbookLiquidity(marketIdNum, rows);
        showNotification('Initial YES/NO liquidity added on blockchain!', 'success');
      }
      
      // Create poll in backend with marketId
      await api.post('/admin/polls', {
        ...pollData,
        optionType: 'options',
        marketId: marketIdNum,
        marketInitialized: rows.length > 0,
      });
      
      fetchData();
      showNotification('Poll created successfully on blockchain and backend!', 'success');
    } catch (error) {
      console.error('Error creating poll:', error);
      showNotification(getBlockchainErrorMessage(error) || error.message || 'Failed to create poll', 'error');
    }
  };

  const handleResolvePoll = async (pollId, result, optionIndex) => {
    try {
      // Auto-connects wallet and switches network if needed
      // Get poll to get marketId
      const pollResponse = await api.get(`/polls/${pollId}`);
      const poll = pollResponse.data;
      
      if (!poll.marketId) {
        showNotification('Market not created on blockchain yet', 'error');
        return;
      }
      
      // Determine winning option
      let winningOption = result;
      if (poll.optionType === 'options' && optionIndex !== undefined) {
        winningOption = poll.options[optionIndex].text;
      } else if (result) {
        winningOption = result.toUpperCase();
      }
      
      // Resolve on blockchain first
      try {
        const txHash = await resolveMarket(poll.marketId, winningOption);
        showNotification(`Poll resolved on blockchain! TX: ${txHash.slice(0, 10)}...`, 'success');
        
        // Then resolve in backend only after blockchain success
        const payload = optionIndex !== undefined ? { optionIndex } : { result };
        await api.post(`/admin/polls/${pollId}/resolve`, payload);
      } catch (blockchainError) {
        console.error('Blockchain transaction failed:', blockchainError);
        showNotification(blockchainError.message || 'Blockchain transaction failed. Please try again.', 'error');
        throw blockchainError; // Re-throw to prevent backend call
      }
      fetchData();
      showNotification('Poll resolved successfully!', 'success');
    } catch (error) {
      console.error('Error resolving poll:', error);
      showNotification(error.message || 'Failed to resolve poll', 'error');
    }
  };

  const handleUpdatePoll = async (pollId, updates) => {
    try {
      await api.put(`/admin/polls/${pollId}`, updates);
      fetchData();
      showNotification('Poll updated successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to update poll', 'error');
    }
  };

  const handleUpdatePollStatus = async (pollId, updates) => {
    try {
      await api.post(`/admin/polls/${pollId}/status`, updates);
      fetchData();
      showNotification('Poll status updated successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to update poll status', 'error');
    }
  };

  const handleAddPollLiquidity = async (pollId, liquidity) => {
    try {
      // Auto-connects wallet and switches network if needed
      // Get poll to get marketId
      const pollResponse = await api.get(`/polls/${pollId}`);
      const poll = pollResponse.data;
      
      if (!poll.marketId) {
        showNotification('Market not created on blockchain yet', 'error');
        return;
      }
      
      // Add liquidity on blockchain first
      try {
        if (poll.optionType === 'options') {
          if (Array.isArray(liquidity.options) && liquidity.options.length > 0) {
            for (const opt of liquidity.options) {
              const amount = parseFloat(opt?.liquidity) || 0;
              const text = String(opt?.text || '').trim();
              if (amount > 0 && text) {
                await addLiquidity(poll.marketId, text, amount);
              }
            }
          } else if (liquidity.optionIndex !== undefined && liquidity.optionIndex !== '') {
            const idx = parseInt(liquidity.optionIndex, 10);
            const optionText = poll.options && poll.options[idx] ? String(poll.options[idx].text || '').trim() : '';
            if (!optionText) {
              showNotification('Invalid option selected for this poll', 'error');
              return;
            }
            const y = parseFloat(liquidity.optionYes) || 0;
            const n = parseFloat(liquidity.optionNo) || 0;
            const legacy = parseFloat(liquidity.optionLiquidity) || 0;
            const useLegacySplit = y <= 0 && n <= 0 && legacy > 0;
            const yesAmt = useLegacySplit ? legacy / 2 : y;
            const noAmt = useLegacySplit ? legacy / 2 : n;
            const rows = [{ option: optionText, yesAmount: yesAmt, noAmount: noAmt }].filter(
              (r) => (parseFloat(r.yesAmount) || 0) + (parseFloat(r.noAmount) || 0) > 0
            );
            if (rows.length === 0) {
              showNotification('Enter YES and/or NO liquidity', 'warning');
              return;
            }
            let total = 0n;
            for (const r of rows) {
              total += usdcToUnits(r.yesAmount) + usdcToUnits(r.noAmount);
            }
            if (total > 0n) await ensureUsdcAllowance(total);
            await batchAddOrderbookLiquidity(poll.marketId, rows);
          } else {
            showNotification('Please select an option and enter liquidity', 'warning');
            return;
          }
        } else {
          // Normal Yes/No poll
          if (liquidity.yesLiquidity > 0) {
            await addLiquidity(poll.marketId, 'YES', liquidity.yesLiquidity);
          }
          if (liquidity.noLiquidity > 0) {
            await addLiquidity(poll.marketId, 'NO', liquidity.noLiquidity);
          }
        }
        
        showNotification('Liquidity added on blockchain!', 'success');
        
        // Update backend only after blockchain success
        await api.post(`/admin/polls/${pollId}/liquidity`, liquidity);
        fetchData();
        showNotification('Liquidity added successfully!', 'success');
      } catch (blockchainError) {
        console.error('Blockchain transaction failed:', blockchainError);
        showNotification(blockchainError.message || 'Blockchain transaction failed. Please try again.', 'error');
        throw blockchainError; // Re-throw to prevent backend call
      }
    } catch (error) {
      console.error('Error adding liquidity:', error);
      showNotification(error.message || 'Failed to add liquidity', 'error');
    }
  };

  const handleDeletePoll = async (pollId) => {
    try {
      await api.delete(`/admin/polls/${pollId}`);
      fetchData();
      showNotification('Poll deleted successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to delete poll', 'error');
    }
  };

  const handleCreateCup = async (cupData) => {
    try {
      await api.post('/admin/cups', cupData);
      fetchData();
      showNotification('Cup created successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to create cup', 'error');
    }
  };

  const handleUpdateCup = async (cupId, updates) => {
    try {
      await api.put(`/admin/cups/${cupId}`, updates);
      fetchData();
      showNotification('Cup updated successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to update cup', 'error');
    }
  };

  const handleDeleteCup = async (cupId) => {
    try {
      await api.delete(`/admin/cups/${cupId}`);
      fetchData();
      showNotification('Cup deleted successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to delete cup', 'error');
    }
  };

  const handleUpdateNavbarOrder = async (cupOrders) => {
    try {
      await api.post('/admin/cups/navbar-order', { cupOrders });
      fetchData();
      showNotification('Navbar order updated successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to update navbar order', 'error');
    }
  };

  const handleCreateBlog = async (blogData) => {
    try {
      await api.post('/admin/blogs', blogData);
      fetchData();
      showNotification('Blog created successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to create blog', 'error');
    }
  };

  const handleUpdateBlog = async (blogId, updates) => {
    try {
      await api.put(`/admin/blogs/${blogId}`, updates);
      fetchData();
      showNotification('Blog updated successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to update blog', 'error');
    }
  };

  const handleDeleteBlog = async (blogId) => {
    try {
      await api.delete(`/admin/blogs/${blogId}`);
      fetchData();
      showNotification('Blog deleted successfully!', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to delete blog', 'error');
    }
  };

  const handleUpdateStatus = async (matchId, updates) => {
    try {
      // Auto-connects wallet and switches network if needed
      // Get match to get marketId
      const matchResponse = await api.get(`/matches/${matchId}`);
      const match = matchResponse.data;
      
      if (!match.marketId) {
        showNotification('Market not created on blockchain yet', 'error');
        return;
      }
      
      // Map status to blockchain enum (0=Upcoming, 1=Active, 2=Locked, 3=Resolved)
      let statusValue = 0;
      if (updates.status === 'active') statusValue = 1;
      else if (updates.status === 'locked') statusValue = 2;
      else if (updates.status === 'resolved' || updates.status === 'completed') statusValue = 3;
      
      // Update status on blockchain first
      try {
        const txHash = await updateMarketStatus(match.marketId, statusValue);
        showNotification(`Status updated on blockchain! TX: ${txHash.slice(0, 10)}...`, 'success');
        
        // Update in backend only after blockchain success
        await api.post(`/admin/matches/${matchId}/status`, updates);
        fetchData();
        showNotification('Status updated successfully!', 'success');
      } catch (blockchainError) {
        console.error('Blockchain transaction failed:', blockchainError);
        showNotification(blockchainError.message || 'Blockchain transaction failed. Please try again.', 'error');
        throw blockchainError; // Re-throw to prevent backend call
      }
    } catch (error) {
      console.error('Error updating status:', error);
      showNotification(error.message || 'Failed to update status', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-8">
          Admin Dashboard
        </h1>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
          <nav className="-mb-px flex space-x-8">
            {['matches', 'polls', 'cups', 'stages', 'blogs', 'newsletter', 'settings'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        {activeTab === 'matches' && (
          <MatchesTab
            matches={matches}
            cups={cups}
            stages={stages}
            loading={loading}
            tablePage={tablePage}
            setTablePage={setTablePage}
            itemsPerPage={ITEMS_PER_PAGE}
            onCreateMatch={handleCreateMatch}
            onUpdateMatch={handleUpdateMatch}
            onResolveMatch={handleResolveMatch}
            onUpdateStatus={handleUpdateStatus}
            onDeleteMatch={handleDeleteMatch}
            onAddLiquidity={handleAddMatchLiquidity}
          />
        )}
        {activeTab === 'polls' && (
          <PollsTab
            polls={polls}
            cups={cups}
            stages={stages}
            loading={loading}
            tablePage={tablePage}
            setTablePage={setTablePage}
            itemsPerPage={ITEMS_PER_PAGE}
            onCreatePoll={handleCreatePoll}
            onResolvePoll={handleResolvePoll}
            onUpdatePoll={handleUpdatePoll}
            onUpdatePollStatus={handleUpdatePollStatus}
            onAddLiquidity={handleAddPollLiquidity}
            onDeletePoll={handleDeletePoll}
          />
        )}
        {activeTab === 'cups' && (
          <CupsTab 
            cups={cups} 
            loading={loading}
            tablePage={tablePage}
            setTablePage={setTablePage}
            itemsPerPage={ITEMS_PER_PAGE}
            onCreateCup={handleCreateCup}
            onUpdateCup={handleUpdateCup}
            onDeleteCup={handleDeleteCup}
            onUpdateNavbarOrder={handleUpdateNavbarOrder}
          />
        )}
        {activeTab === 'stages' && (
          <StagesTab
            cups={cups}
            stages={stages}
            loading={loading}
            tablePage={tablePage}
            setTablePage={setTablePage}
            itemsPerPage={ITEMS_PER_PAGE}
            onCreateStage={handleCreateStage}
            onUpdateStage={handleUpdateStage}
            onDeleteStage={handleDeleteStage}
          />
        )}
        {activeTab === 'blogs' && (
          <BlogsTab
            blogs={blogs}
            loading={loading}
            tablePage={tablePage}
            setTablePage={setTablePage}
            itemsPerPage={ITEMS_PER_PAGE}
            onCreateBlog={handleCreateBlog}
            onUpdateBlog={handleUpdateBlog}
            onDeleteBlog={handleDeleteBlog}
          />
        )}
        {activeTab === 'newsletter' && <NewsletterTab />}
        {activeTab === 'settings' && (
          <SettingsTab />
        )}
      </div>
    </div>
  );
};

const MatchesTab = ({ matches, cups, stages, loading, tablePage, setTablePage, itemsPerPage, onCreateMatch, onUpdateMatch, onResolveMatch, onUpdateStatus, onDeleteMatch, onAddLiquidity }) => {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(null);
  const [showStatusModal, setShowStatusModal] = useState(null);
  const [showEditModal, setShowEditModal] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  const [showLiquidityModal, setShowLiquidityModal] = useState(null);
  const [poolModal, setPoolModal] = useState(null);

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Matches</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Create Match
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Teams</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Result</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {(() => {
              const paginatedMatches = matches.slice((tablePage - 1) * itemsPerPage, tablePage * itemsPerPage);
              return paginatedMatches.map((match) => (
              <tr key={match._id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                  {match.teamA} vs {match.teamB}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {new Date(match.date).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    match.status === 'upcoming' ? 'bg-yellow-100 text-yellow-800' :
                    match.status === 'live' ? 'bg-green-100 text-green-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {match.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {(() => {
                    if (!match.result) return 'Pending';
                    const result = String(match.result).trim();
                    if (result === 'TeamA' || result.toLowerCase() === 'teama') {
                      return match.teamA || 'Team A';
                    }
                    if (result === 'TeamB' || result.toLowerCase() === 'teamb') {
                      return match.teamB || 'Team B';
                    }
                    if (result === 'Draw' || result.toLowerCase() === 'draw') {
                      return 'Draw';
                    }
                    // If backend already stored a display name, show it as-is
                    return result;
                  })()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setShowStatusModal(match)}
                      className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-xs"
                    >
                      Status
                    </button>
                    <button
                      onClick={() => setShowEditModal(match)}
                      className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setPoolModal({ kind: 'match', item: { ...match, label: `${match.teamA} vs ${match.teamB}` }, poolType: 'jackpot' })}
                      className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-xs"
                    >
                      Jackpot
                    </button>
                    <button
                      onClick={() => setPoolModal({ kind: 'match', item: { ...match, label: `${match.teamA} vs ${match.teamB}` }, poolType: 'boost' })}
                      className="px-3 py-1 bg-teal-600 text-white rounded hover:bg-teal-700 text-xs"
                    >
                      Boost pool
                    </button>
                    <button
                      onClick={() => setShowLiquidityModal(match)}
                      className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 text-xs"
                    >
                      Add Liquidity
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/market/match/${match._id}`)}
                      className="px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-xs"
                    >
                      Control
                    </button>
                    {!match.isResolved && (
                      <button
                        onClick={() => setShowResolveModal(match)}
                        className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-xs"
                      >
                        Resolve
                      </button>
                    )}
                    <button
                      onClick={() => setShowDeleteModal(match)}
                      className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ));
            })()}
          </tbody>
        </table>
        </div>
        {matches.length > itemsPerPage && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              disabled={tablePage <= 1}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Page {tablePage} of {Math.max(1, Math.ceil(matches.length / itemsPerPage))} ({matches.length} total)
            </span>
            <button
              onClick={() => setTablePage((p) => Math.min(Math.ceil(matches.length / itemsPerPage), p + 1))}
              disabled={tablePage >= Math.ceil(matches.length / itemsPerPage)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {poolModal && (
        <AdminPoolModal
          kind={poolModal.kind}
          item={poolModal.item}
          poolType={poolModal.poolType}
          onClose={() => setPoolModal(null)}
        />
      )}

      {showCreateModal && (
        <CreateMatchModal
          cups={cups}
          stages={stages}
          onClose={() => setShowCreateModal(false)}
          onSubmit={onCreateMatch}
        />
      )}

      {showResolveModal && (
        <ResolveModal
          item={showResolveModal}
          type="match"
          onClose={() => setShowResolveModal(null)}
          onSubmit={onResolveMatch}
        />
      )}

      {showStatusModal && (
        <StatusModal
          match={showStatusModal}
          onClose={() => setShowStatusModal(null)}
          onSubmit={onUpdateStatus}
        />
      )}

      {showEditModal && (
        <EditMatchModal
          match={showEditModal}
          cups={cups}
          stages={stages}
          onClose={() => setShowEditModal(null)}
          onSubmit={(updates) => {
            onUpdateMatch(showEditModal._id, updates);
            setShowEditModal(null);
          }}
        />
      )}

      {showDeleteModal && (
        <Modal isOpen={true} onClose={() => setShowDeleteModal(null)} title="Delete Match">
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              Are you sure you want to delete <strong>{showDeleteModal.teamA} vs {showDeleteModal.teamB}</strong>? This action cannot be undone.
            </p>
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  onDeleteMatch(showDeleteModal._id);
                  setShowDeleteModal(null);
                }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setShowDeleteModal(null)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showLiquidityModal && (
        <AddLiquidityModal
          match={showLiquidityModal}
          onClose={() => setShowLiquidityModal(null)}
          onSubmit={async (liquidity) => {
            await onAddLiquidity(showLiquidityModal._id, liquidity);
            // Modal will close itself after successful submission
          }}
        />
      )}
    </div>
  );
};

const CreateMatchModal = ({ cups, stages, onClose, onSubmit }) => {
  // USDC ~ USD; show $ directly
  const [formData, setFormData] = useState({
    teamA: '',
    teamB: '',
    date: '',
    cup: '',
    stage: '',
    stageName: '',
    drawEnabled: true,
    minFreeTickets: 1,
    freePredictionEnabled: true,
    marketEnabled: true,
    // YES/NO seed liquidity per outcome (orderbook reference liquidity)
    teamAYes: '',
    teamANo: '',
    teamBYes: '',
    teamBNo: '',
    drawYes: '',
    drawNo: '',
    isFeatured: false,
    isSponsored: false,
    sponsoredImages: [],
    lockedTime: '',
    teamAImage: '',
    teamBImage: '',
  });
  const [targetOdds, setTargetOdds] = useState(() =>
    distributeEvenlyWithBalance(
      [
        { optionKey: 'TeamA', pct: 0 },
        { optionKey: 'Draw', pct: 0 },
        { optionKey: 'TeamB', pct: 0 },
      ],
      'TeamB'
    )
  );
  const [availableStages, setAvailableStages] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setTargetOdds(
      formData.drawEnabled
        ? distributeEvenlyWithBalance(
            [
              { optionKey: 'TeamA', pct: 0 },
              { optionKey: 'Draw', pct: 0 },
              { optionKey: 'TeamB', pct: 0 },
            ],
            'TeamB'
          )
        : distributeEvenlyWithBalance(
            [
              { optionKey: 'TeamA', pct: 0 },
              { optionKey: 'TeamB', pct: 0 },
            ],
            'TeamB'
          )
    );
  }, [formData.drawEnabled]);

  useEffect(() => {
    if (formData.cup) {
      // Find the cup to get its slug
      const selectedCup = cups.find(c => c._id === formData.cup || c.slug === formData.cup);
      if (selectedCup) {
        // Fetch stages for the selected cup
        api.get(`/cups/${selectedCup.slug}/stages`)
          .then(response => {
            setAvailableStages(response.data);
          })
          .catch(error => {
            console.error('Error fetching stages:', error);
            setAvailableStages([]);
          });
      } else {
        setAvailableStages([]);
      }
    } else {
      setAvailableStages([]);
    }
  }, [formData.cup, cups]);

  const matchOddsLabel = (optionKey) => {
    if (optionKey === 'TeamA') return formData.teamA || 'Team A';
    if (optionKey === 'TeamB') return formData.teamB || 'Team B';
    if (optionKey === 'Draw') return 'Draw';
    return optionKey;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const selectedStage = availableStages.find(s => s._id === formData.stage);
      const activeKeys = formData.drawEnabled ? ['TeamA', 'Draw', 'TeamB'] : ['TeamA', 'TeamB'];
      const oddsRows = targetOdds.filter((r) => activeKeys.includes(r.optionKey));
      const startingPrices = startingPricesFromPctRows(
        oddsRows.length ? oddsRows : evenPctSplit(activeKeys)
      );
      await onSubmit({
        ...formData,
        stageName: selectedStage?.name || formData.stageName,
        minFreeTickets: parseInt(formData.minFreeTickets, 10) || 1,
        freePredictionEnabled: formData.freePredictionEnabled,
        marketEnabled: formData.marketEnabled,
        drawEnabled: formData.drawEnabled,
        startingPrices,
        teamAYes: parseFloat(formData.teamAYes) || 0,
        teamANo: parseFloat(formData.teamANo) || 0,
        teamBYes: parseFloat(formData.teamBYes) || 0,
        teamBNo: parseFloat(formData.teamBNo) || 0,
        drawYes: parseFloat(formData.drawYes) || 0,
        drawNo: parseFloat(formData.drawNo) || 0,
        // Also send canonical rows for backend storage
        yesNo: [
          { option: 'TeamA', yesAmount: parseFloat(formData.teamAYes) || 0, noAmount: parseFloat(formData.teamANo) || 0 },
          { option: 'TeamB', yesAmount: parseFloat(formData.teamBYes) || 0, noAmount: parseFloat(formData.teamBNo) || 0 },
          { option: 'Draw', yesAmount: parseFloat(formData.drawYes) || 0, noAmount: parseFloat(formData.drawNo) || 0 },
        ],
      });
      // Only close modal after successful submission
      onClose();
    } catch (error) {
      console.error('Error creating match:', error);
      // Don't close modal on error
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Create Match" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <input
              type="text"
              placeholder="Team A"
              value={formData.teamA}
              onChange={(e) => setFormData({ ...formData, teamA: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white mb-2"
              required
            />
            <ImageUpload
              label="Team A Image"
              value={formData.teamAImage}
              onChange={(url) => setFormData({ ...formData, teamAImage: url })}
              folder="wergame/teams"
            />
          </div>
          <div>
            <input
              type="text"
              placeholder="Team B"
              value={formData.teamB}
              onChange={(e) => setFormData({ ...formData, teamB: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white mb-2"
              required
            />
            <ImageUpload
              label="Team B Image"
              value={formData.teamBImage}
              onChange={(url) => setFormData({ ...formData, teamBImage: url })}
              folder="wergame/teams"
            />
          </div>
        </div>
        <input
          type="datetime-local"
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <select
          value={formData.cup}
          onChange={(e) => {
            setFormData({ ...formData, cup: e.target.value, stage: '', stageName: '' });
          }}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        >
          <option value="">Select Cup</option>
          {cups.map((cup) => (
            <option key={cup._id} value={cup._id}>{cup.name}</option>
          ))}
        </select>
        
        {/* Stage Selection - Always show when cup is selected */}
        {formData.cup && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Stage <span className="text-gray-500">(optional)</span>
            </label>
            {availableStages.length > 0 ? (
              <select
                value={formData.stage}
                onChange={(e) => {
                  const selectedStage = availableStages.find(s => s._id === e.target.value);
                  setFormData({ ...formData, stage: e.target.value, stageName: selectedStage?.name || '' });
                }}
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              >
                <option value="">Select Stage (optional)</option>
                {availableStages.map((stage) => (
                  <option key={stage._id} value={stage._id}>{stage.name}</option>
                ))}
              </select>
            ) : (
              <>
                <div className="text-sm text-yellow-600 dark:text-yellow-400 mb-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                  No stages found for this cup. Create stages in the Stages tab first.
                </div>
                <input
                  type="text"
                  placeholder="Or enter a custom stage name"
                  value={formData.stageName}
                  onChange={(e) => setFormData({ ...formData, stageName: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                />
              </>
            )}
            {formData.stage && availableStages.length > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Selected: {availableStages.find(s => s._id === formData.stage)?.name}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Min tickets per free pick</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setFormData((f) => ({ ...f, minFreeTickets: Math.max(1, (parseInt(f.minFreeTickets, 10) || 1) - 1) }))} className="w-10 h-10 border rounded-lg font-bold">−</button>
              <span className="flex-1 text-center text-lg font-bold tabular-nums">{formData.minFreeTickets}</span>
              <button type="button" onClick={() => setFormData((f) => ({ ...f, minFreeTickets: (parseInt(f.minFreeTickets, 10) || 1) + 1 }))} className="w-10 h-10 border rounded-lg font-bold">+</button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={formData.freePredictionEnabled} onChange={(e) => setFormData({ ...formData, freePredictionEnabled: e.target.checked })} />
              <span className="text-sm text-gray-700 dark:text-gray-300">Free prediction enabled</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={formData.marketEnabled} onChange={(e) => setFormData({ ...formData, marketEnabled: e.target.checked })} />
              <span className="text-sm text-gray-700 dark:text-gray-300">Market enabled</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={formData.drawEnabled} onChange={(e) => setFormData({ ...formData, drawEnabled: e.target.checked })} />
              <span className="text-sm text-gray-700 dark:text-gray-300">Draw outcome enabled</span>
            </label>
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Target odds (%)</p>
          <TargetOddsInputs
            rows={targetOdds.filter((r) =>
              formData.drawEnabled ? true : r.optionKey !== 'Draw'
            )}
            balanceOptionKey="TeamB"
            onUpdateRows={(rows) => {
              if (formData.drawEnabled) {
                setTargetOdds(rows);
              } else {
                const drawRow = targetOdds.find((r) => r.optionKey === 'Draw');
                setTargetOdds(drawRow ? [...rows, drawRow] : rows);
              }
            }}
            getLabel={matchOddsLabel}
          />
        </div>
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Initial liquidity is per outcome and per side (YES / NO). This seeds the orderbook reference liquidity.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="border rounded-lg p-3 dark:border-gray-700">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">{formData.teamA || 'Team A'}</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.01"
                  placeholder="YES (USDC)"
                  value={formData.teamAYes}
                  onChange={(e) => setFormData({ ...formData, teamAYes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="NO (USDC)"
                  value={formData.teamANo}
                  onChange={(e) => setFormData({ ...formData, teamANo: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                />
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                Total: {formatUsdAmount((parseFloat(formData.teamAYes) || 0) + (parseFloat(formData.teamANo) || 0))}
              </p>
            </div>
            {formData.drawEnabled && (
            <div className="border rounded-lg p-3 dark:border-gray-700">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">Draw</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.01"
                  placeholder="YES (USDC)"
                  value={formData.drawYes}
                  onChange={(e) => setFormData({ ...formData, drawYes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="NO (USDC)"
                  value={formData.drawNo}
                  onChange={(e) => setFormData({ ...formData, drawNo: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                />
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                Total: {formatUsdAmount((parseFloat(formData.drawYes) || 0) + (parseFloat(formData.drawNo) || 0))}
              </p>
            </div>
            )}
            <div className="border rounded-lg p-3 dark:border-gray-700">
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">{formData.teamB || 'Team B'}</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.01"
                  placeholder="YES (USDC)"
                  value={formData.teamBYes}
                  onChange={(e) => setFormData({ ...formData, teamBYes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="NO (USDC)"
                  value={formData.teamBNo}
                  onChange={(e) => setFormData({ ...formData, teamBNo: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                />
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                Total: {formatUsdAmount((parseFloat(formData.teamBYes) || 0) + (parseFloat(formData.teamBNo) || 0))}
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isFeatured}
              onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Featured Match</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isSponsored}
              onChange={(e) => setFormData({ ...formData, isSponsored: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Sponsored Match</span>
          </label>
        </div>
        
        {/* Sponsored Images - Show when sponsored is checked */}
        {formData.isSponsored && (
          <div className="border p-4 rounded-lg dark:border-gray-700">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Sponsored Images (optional)
            </label>
            <div className="space-y-2">
              {formData.sponsoredImages.map((img, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <img src={img} alt={`Sponsor ${idx + 1}`} className="w-16 h-16 object-cover rounded-lg" />
                  <button
                    type="button"
                    onClick={() => {
                      const newImages = formData.sponsoredImages.filter((_, i) => i !== idx);
                      setFormData({ ...formData, sponsoredImages: newImages });
                    }}
                    className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <ImageUpload
                label="Add Sponsored Image"
                value=""
                onChange={(url) => {
                  if (url) {
                    setFormData({ ...formData, sponsoredImages: [...formData.sponsoredImages, url] });
                  }
                }}
                folder="wergame/sponsored"
              />
            </div>
          </div>
        )}

        {/* Locked Time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Locked Time (optional) - When predictions should be locked
          </label>
          <input
            type="datetime-local"
            value={formData.lockedTime}
            onChange={(e) => setFormData({ ...formData, lockedTime: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div className="flex space-x-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Creating...' : 'Create'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

const ResolveModal = ({ item, type, onClose, onSubmit }) => {
  const [result, setResult] = useState('');
  const [optionIndex, setOptionIndex] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      // Map the display value to the backend expected value
      let backendResult = result;
      if (type === 'match') {
        if (result === item.teamA) {
          backendResult = 'teamA';
        } else if (result === item.teamB) {
          backendResult = 'teamB';
        } else if (result === 'Draw') {
          backendResult = 'draw';
        }
        await onSubmit(item._id, backendResult);
      } else {
        // For polls
        if (item.optionType === 'options') {
          // Option-based poll - send optionIndex
          await onSubmit(item._id, null, parseInt(optionIndex));
        } else {
          // Normal Yes/No poll
          backendResult = result.toUpperCase();
          await onSubmit(item._id, backendResult);
        }
      }
      // Only close modal after successful submission
      onClose();
    } catch (error) {
      // Error already handled in onSubmit, just don't close modal
      console.error('Error in resolve modal:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const options = type === 'match' 
    ? [item.teamA, 'Draw', item.teamB]
    : (item.optionType === 'options' && item.options) 
      ? item.options.map((opt, idx) => ({ text: opt.text, index: idx, image: opt.image }))
      : ['YES', 'NO'];

  return (
    <Modal isOpen={true} onClose={onClose} title={`Resolve ${type === 'match' ? 'Match' : 'Poll'}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Result
          </label>
          {type === 'poll' && item.optionType === 'options' ? (
            <div className="space-y-2">
              {options.map((opt) => (
                <label
                  key={opt.index}
                  className={`flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                    optionIndex === opt.index.toString() ? 'border-blue-500 bg-blue-50 dark:bg-blue-900' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="pollOption"
                    value={opt.index}
                    checked={optionIndex === opt.index.toString()}
                    onChange={(e) => setOptionIndex(e.target.value)}
                    className="mr-3"
                    required
                  />
                  {opt.image && (
                    <img src={opt.image} alt={opt.text} className="w-10 h-10 object-cover rounded-full mr-3" />
                  )}
                  <span className="text-gray-900 dark:text-white font-medium">{opt.text}</span>
                </label>
              ))}
            </div>
          ) : (
            <select
              value={type === 'poll' && item.optionType === 'options' ? optionIndex : result}
              onChange={(e) => {
                if (type === 'poll' && item.optionType === 'options') {
                  setOptionIndex(e.target.value);
                } else {
                  setResult(e.target.value);
                }
              }}
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              required
            >
              <option value="">Select result</option>
              {options.map((opt) => (
                <option key={typeof opt === 'string' ? opt : opt.index} value={typeof opt === 'string' ? opt : opt.index}>
                  {typeof opt === 'string' ? opt : opt.text}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex space-x-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Resolving...' : 'Resolve'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

const StatusModal = ({ match, onClose, onSubmit }) => {
  const [status, setStatus] = useState(match.status);

  const handleSubmit = (e) => {
    e.preventDefault();
    const updates = { status };
    // If status is set to locked, immediately lock (override any locked time)
    if (status === 'locked') {
      updates.lockedTime = new Date().toISOString();
    }
    onSubmit(match._id, updates);
    onClose();
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Update Match Status">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
            required
          >
            <option value="upcoming">Upcoming</option>
            <option value="live">Live</option>
            <option value="locked">Locked</option>
            <option value="completed">Completed</option>
          </select>
          {status === 'locked' && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              Setting status to "Locked" will immediately lock predictions for this match.
            </p>
          )}
        </div>
        <div className="flex space-x-2">
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Update
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

const PollsTab = ({ polls, cups, stages, loading, tablePage, setTablePage, itemsPerPage, onCreatePoll, onResolvePoll, onUpdatePoll, onUpdatePollStatus, onAddLiquidity, onDeletePoll }) => {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResolveModal, setShowResolveModal] = useState(null);
  const [showEditModal, setShowEditModal] = useState(null);
  const [showStatusModal, setShowStatusModal] = useState(null);
  const [showLiquidityModal, setShowLiquidityModal] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  const [poolModal, setPoolModal] = useState(null);

  if (loading) return <div className="text-center py-12">Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Polls</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Create Poll
        </button>
      </div>
      
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Question</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Date (GMT)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Result</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {(() => {
              const paginatedPolls = polls.slice((tablePage - 1) * itemsPerPage, tablePage * itemsPerPage);
              return polls.length > 0 ? (
              paginatedPolls.map((poll) => (
                <tr key={poll._id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    {poll.question}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {poll.date ? formatEventDateGmt(poll.date) : '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {poll.type}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      poll.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                      poll.status === 'settled' ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' :
                      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    }`}>
                      {poll.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {poll.result || 'Pending'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setShowStatusModal(poll)}
                        className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-xs"
                      >
                        Status
                      </button>
                      <button
                        onClick={() => setShowEditModal(poll)}
                        className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setPoolModal({ kind: 'poll', item: { ...poll, label: poll.question }, poolType: 'jackpot' })}
                        className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-xs"
                      >
                        Jackpot
                      </button>
                      <button
                        onClick={() => setPoolModal({ kind: 'poll', item: { ...poll, label: poll.question }, poolType: 'boost' })}
                        className="px-3 py-1 bg-teal-600 text-white rounded hover:bg-teal-700 text-xs"
                      >
                        Boost pool
                      </button>
                      <button
                        onClick={() => setShowLiquidityModal(poll)}
                        className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 text-xs"
                      >
                        Add Liquidity
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate(`/admin/market/poll/${poll._id}`)}
                        className="px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-xs"
                      >
                        Control
                      </button>
                      {!poll.isResolved && (
                        <button
                          onClick={() => setShowResolveModal(poll)}
                          className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-xs"
                        >
                          Resolve
                        </button>
                      )}
                      <button
                        onClick={() => setShowDeleteModal(poll)}
                        className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6" className="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  No polls found. Create one to get started!
                </td>
              </tr>
            );
            })()}
          </tbody>
        </table>
        </div>
        {polls.length > itemsPerPage && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              disabled={tablePage <= 1}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Page {tablePage} of {Math.max(1, Math.ceil(polls.length / itemsPerPage))} ({polls.length} total)
            </span>
            <button
              onClick={() => setTablePage((p) => Math.min(Math.ceil(polls.length / itemsPerPage), p + 1))}
              disabled={tablePage >= Math.ceil(polls.length / itemsPerPage)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
      
      {poolModal && (
        <AdminPoolModal
          kind={poolModal.kind}
          item={poolModal.item}
          poolType={poolModal.poolType}
          onClose={() => setPoolModal(null)}
        />
      )}

      {showCreateModal && (
        <CreatePollModal
          cups={cups}
          stages={stages}
          onClose={() => setShowCreateModal(false)}
          onSubmit={onCreatePoll}
        />
      )}
      {showResolveModal && (
        <ResolveModal
          item={showResolveModal}
          type="poll"
          onClose={() => setShowResolveModal(null)}
          onSubmit={onResolvePoll}
        />
      )}

      {showEditModal && (
        <EditPollModal
          poll={showEditModal}
          cups={cups}
          onClose={() => setShowEditModal(null)}
          onSubmit={(updates) => {
            onUpdatePoll(showEditModal._id, updates);
            setShowEditModal(null);
          }}
        />
      )}

      {showStatusModal && (
        <PollStatusModal
          poll={showStatusModal}
          onClose={() => setShowStatusModal(null)}
          onSubmit={onUpdatePollStatus}
        />
      )}

      {showLiquidityModal && (
        <AddPollLiquidityModal
          poll={showLiquidityModal}
          onClose={() => setShowLiquidityModal(null)}
          onSubmit={async (liquidity) => {
            await onAddLiquidity(showLiquidityModal._id, liquidity);
            // Modal will close itself after successful submission
          }}
        />
      )}

      {showDeleteModal && (
        <Modal isOpen={true} onClose={() => setShowDeleteModal(null)} title="Delete Poll">
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              Are you sure you want to delete <strong>{showDeleteModal.question}</strong>? This action cannot be undone.
            </p>
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  onDeletePoll(showDeleteModal._id);
                  setShowDeleteModal(null);
                }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setShowDeleteModal(null)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

const CreatePollModal = ({ cups, stages, onClose, onSubmit }) => {
  // USDC ~ USD; no price API needed
  const [formData, setFormData] = useState({
    question: '',
    thumbnailImage: '',
    description: '',
    type: 'match',
    cup: '',
    optionType: 'options',
    minFreeTickets: 1,
    freePredictionEnabled: true,
    marketEnabled: true,
    isFeatured: false,
    isSponsored: false,
    sponsoredImages: [],
    date: '',
    lockedTime: '',
    options: [],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addOption = () => {
    setFormData((prev) => {
      const newOptions = [
        ...prev.options,
        { text: '', image: '', yesLiquidity: '', noLiquidity: '', targetPct: 0, quoteVolumeUsdc: 200 },
      ];
      const keys = newOptions.map((_, i) => `__idx_${i}`);
      const balanceKey = keys[keys.length - 1];
      const split = distributeEvenlyWithBalance(
        keys.map((optionKey) => ({ optionKey, pct: 0 })),
        balanceKey
      );
      return {
        ...prev,
        options: newOptions.map((opt, i) => ({
          ...opt,
          targetPct: split[i]?.pct ?? 100 / newOptions.length,
        })),
      };
    });
  };

  const removeOption = (index) => {
    setFormData((prev) => {
      const newOptions = prev.options.filter((_, i) => i !== index);
      if (!newOptions.length) return { ...prev, options: [] };
      const keys = newOptions.map((_, i) => `__idx_${i}`);
      const balanceKey = keys[keys.length - 1];
      const split = distributeEvenlyWithBalance(
        keys.map((optionKey) => ({ optionKey, pct: 0 })),
        balanceKey
      );
      return {
        ...prev,
        options: newOptions.map((opt, i) => ({
          ...opt,
          targetPct: split[i]?.pct ?? 100 / newOptions.length,
        })),
      };
    });
  };

  const updateOption = (index, field, value) => {
    const newOptions = [...formData.options];
    newOptions[index] = { ...newOptions[index], [field]: value };
    setFormData({ ...formData, options: newOptions });
  };

  const pollOddsRows = formData.options.map((opt, i) => ({
    optionKey: `__idx_${i}`,
    pct: Number(opt.targetPct) || 0,
    quoteVolumeUsdc: Number(opt.quoteVolumeUsdc) || 200,
  }));

  const updatePollOdds = (rows) => {
    setFormData((prev) => ({
      ...prev,
      options: prev.options.map((opt, i) => {
        const row = rows.find((r) => r.optionKey === `__idx_${i}`);
        return {
          ...opt,
          targetPct: row?.pct ?? opt.targetPct,
          quoteVolumeUsdc: row?.quoteVolumeUsdc ?? opt.quoteVolumeUsdc ?? 200,
        };
      }),
    }));
  };

  const pollOddsLabel = (key) => {
    const i = parseInt(String(key).replace('__idx_', ''), 10);
    const opt = formData.options[i];
    return opt?.text?.trim() || `Option ${i + 1}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const pctRows = formData.options.map((opt, i) => ({
        optionKey: `__idx_${i}`,
        pct: Number(opt.targetPct) || 0,
        quoteVolumeUsdc: Number(opt.quoteVolumeUsdc) || 200,
      }));
      const priceRows = startingPricesFromPctRows(pctRows);
      const startingPrices = priceRows.map((sp, i) => ({
        ...sp,
        optionKey: String(formData.options[i].text || '').trim(),
      }));
      for (const sp of startingPrices) {
        if (!sp.optionKey) {
          alert('Each poll option needs text before creating the market.');
          setIsSubmitting(false);
          return;
        }
      }

      const submitData = {
        ...formData,
        isFeatured: formData.isFeatured || false,
        minFreeTickets: parseInt(formData.minFreeTickets, 10) || 1,
        freePredictionEnabled: formData.freePredictionEnabled,
        marketEnabled: formData.marketEnabled,
        startingPrices,
        date: utcDatetimeLocalToIso(formData.date),
      };

      submitData.optionType = 'options';
      submitData.options = formData.options.map((opt) => ({
        text: String(opt.text || '').trim(),
        image: opt.image || undefined,
        yesLiquidity: parseFloat(opt.yesLiquidity) || 0,
        noLiquidity: parseFloat(opt.noLiquidity) || 0,
      }));

      await onSubmit(submitData);
      // Only close modal after successful submission
      onClose();
    } catch (error) {
      console.error('Error creating poll:', error);
      // Don't close modal on error
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Create Poll" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Question"
          value={formData.question}
          onChange={(e) => setFormData({ ...formData, question: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <ImageUpload
          label="Poll thumbnail"
          value={formData.thumbnailImage}
          onChange={(url) => setFormData({ ...formData, thumbnailImage: url })}
          folder="wergame/polls"
        />
        <textarea
          placeholder="Description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          rows="3"
        />
        <select
          value={formData.type}
          onChange={(e) => setFormData({ ...formData, type: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
        >
          <option value="match">Match</option>
          <option value="team">Team</option>
          <option value="stage">Stage</option>
          <option value="award">Award</option>
        </select>
        <select
          value={formData.cup}
          onChange={(e) => setFormData({ ...formData, cup: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        >
          <option value="">Select Cup</option>
          {cups.map((cup) => (
            <option key={cup._id} value={cup._id}>{cup.name}</option>
          ))}
        </select>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Event date &amp; time (GMT) <span className="text-red-500">*</span>
          </label>
          <input
            type="datetime-local"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
            required
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Enter the wall time in GMT — this is exactly what users will see.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Min tickets per free pick</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setFormData((f) => ({ ...f, minFreeTickets: Math.max(1, (parseInt(f.minFreeTickets, 10) || 1) - 1) }))} className="w-10 h-10 border rounded-lg font-bold">−</button>
              <span className="flex-1 text-center text-lg font-bold tabular-nums">{formData.minFreeTickets}</span>
              <button type="button" onClick={() => setFormData((f) => ({ ...f, minFreeTickets: (parseInt(f.minFreeTickets, 10) || 1) + 1 }))} className="w-10 h-10 border rounded-lg font-bold">+</button>
            </div>
          </div>
          <div className="space-y-2 self-end">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={formData.freePredictionEnabled} onChange={(e) => setFormData({ ...formData, freePredictionEnabled: e.target.checked })} />
              <span className="text-sm text-gray-700 dark:text-gray-300">Free prediction enabled</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={formData.marketEnabled} onChange={(e) => setFormData({ ...formData, marketEnabled: e.target.checked })} />
              <span className="text-sm text-gray-700 dark:text-gray-300">Market enabled</span>
            </label>
          </div>
        </div>
        
        {/* Poll Options (option-based only; per-option YES/NO liquidity) */}
        <div className="space-y-4">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Poll Options
              </label>
              <button
                type="button"
                onClick={addOption}
                className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
              >
                + Add Option
              </button>
            </div>
            {formData.options.length > 0 && (
              <div className="border rounded-lg p-4 dark:border-gray-700 mb-4">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Target odds (%)</p>
                <TargetOddsInputs
                  rows={pollOddsRows}
                  balanceOptionKey={pollOddsRows[pollOddsRows.length - 1]?.optionKey}
                  onUpdateRows={updatePollOdds}
                  getLabel={pollOddsLabel}
                />
              </div>
            )}
            {formData.options.map((option, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Option {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs"
                  >
                    Remove
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Option text"
                  value={option.text}
                  onChange={(e) => updateOption(index, 'text', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                  required
                />
                <ImageUpload
                  label="Option Image"
                  value={option.image}
                  onChange={(url) => updateOption(index, 'image', url)}
                  folder="wergame/poll-options"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">YES liquidity (USDC)</label>
                    <input type="number" step="0.01" placeholder="0" value={option.yesLiquidity} onChange={(e) => updateOption(index, 'yesLiquidity', e.target.value)} className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">NO liquidity (USDC)</label>
                    <input type="number" step="0.01" placeholder="0" value={option.noLiquidity} onChange={(e) => updateOption(index, 'noLiquidity', e.target.value)} className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white" />
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Liq total: {formatUsdAmount((parseFloat(option.yesLiquidity) || 0) + (parseFloat(option.noLiquidity) || 0))}
                </p>
              </div>
            ))}
            {formData.options.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                Click "Add Option" to create poll options
              </p>
            )}
          </div>
        </div>
        
        
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isFeatured}
              onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Featured Poll</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isSponsored}
              onChange={(e) => setFormData({ ...formData, isSponsored: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Sponsored Poll</span>
          </label>
        </div>
        
        {/* Sponsored Images - Show when sponsored is checked */}
        {formData.isSponsored && (
          <div className="border p-4 rounded-lg dark:border-gray-700">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Sponsored Images (optional)
            </label>
            <div className="space-y-2">
              {formData.sponsoredImages.map((img, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <img src={img} alt={`Sponsor ${idx + 1}`} className="w-16 h-16 object-cover rounded-lg" />
                  <button
                    type="button"
                    onClick={() => {
                      const newImages = formData.sponsoredImages.filter((_, i) => i !== idx);
                      setFormData({ ...formData, sponsoredImages: newImages });
                    }}
                    className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <ImageUpload
                label="Add Sponsored Image"
                value=""
                onChange={(url) => {
                  if (url) {
                    setFormData({ ...formData, sponsoredImages: [...formData.sponsoredImages, url] });
                  }
                }}
                folder="wergame/sponsored"
              />
            </div>
          </div>
        )}

        {/* Locked Time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Locked Time (optional) - When predictions should be locked
          </label>
          <input
            type="datetime-local"
            value={formData.lockedTime}
            onChange={(e) => setFormData({ ...formData, lockedTime: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div className="flex space-x-2">
          <button 
            type="submit" 
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Creating...' : 'Create'}
          </button>
          <button 
            type="button" 
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

const CupsTab = ({ cups, loading, tablePage, setTablePage, itemsPerPage, onCreateCup, onUpdateCup, onDeleteCup, onUpdateNavbarOrder }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  const [navbarCups, setNavbarCups] = useState([]);
  const [draggedItem, setDraggedItem] = useState(null);

  useEffect(() => {
    // Sort cups by navbarOrder and filter those with showInNavbar
    const sorted = [...cups]
      .filter(cup => cup.showInNavbar)
      .sort((a, b) => (a.navbarOrder || 0) - (b.navbarOrder || 0));
    setNavbarCups(sorted);
  }, [cups]);

  const handleToggleNavbar = async (cupId, showInNavbar) => {
    try {
      // If enabling, set a default order (max + 1)
      const updates = { showInNavbar };
      if (showInNavbar) {
        const maxOrder = Math.max(...cups.map(c => c.navbarOrder || 0), -1);
        updates.navbarOrder = maxOrder + 1;
      }
      await onUpdateCup(cupId, updates);
    } catch (error) {
      console.error('Error toggling navbar:', error);
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedItem(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    if (draggedItem === null || draggedItem === dropIndex) return;

    const newNavbarCups = [...navbarCups];
    const [removed] = newNavbarCups.splice(draggedItem, 1);
    newNavbarCups.splice(dropIndex, 0, removed);

    // Update navbarOrder for all affected cups
    const cupOrders = newNavbarCups.map((cup, index) => ({
      cupId: cup._id,
      navbarOrder: index,
    }));

    onUpdateNavbarOrder(cupOrders);
    setDraggedItem(null);
  };

  if (loading) return <div className="text-center py-12">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Cups</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Create Cup
        </button>
      </div>

      {/* Navbar Management Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
          Manage Navbar Cups
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Drag and drop to reorder cups in the navbar. Toggle visibility to show/hide cups.
        </p>
        <div className="space-y-2">
          {navbarCups.length > 0 ? (
            navbarCups.map((cup, index) => (
              <div
                key={cup._id}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, index)}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-move hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
                  </svg>
                  <span className="font-medium text-gray-900 dark:text-white">{cup.name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">({cup.slug})</span>
                </div>
                <button
                  onClick={() => handleToggleNavbar(cup._id, false)}
                  className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                >
                  Hide from Navbar
                </button>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No cups in navbar. Toggle "Show in Navbar" for cups below to add them.
            </p>
          )}
        </div>
      </div>
      
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Slug</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Active Matches</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Active Polls</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Navbar</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {(() => {
              const paginatedCups = cups.slice((tablePage - 1) * itemsPerPage, tablePage * itemsPerPage);
              return cups.length > 0 ? (
              paginatedCups.map((cup) => (
                <tr key={cup._id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    {cup.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {cup.slug}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      cup.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                      cup.status === 'completed' ? 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200' :
                      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    }`}>
                      {cup.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {cup.activeMatches || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {cup.activePolls || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cup.showInNavbar || false}
                        onChange={(e) => handleToggleNavbar(cup._id, e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                    </label>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setShowEditModal(cup)}
                        className="px-3 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600 text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setShowDeleteModal(cup)}
                        className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="7" className="px-6 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  No cups found. Create one to get started!
                </td>
              </tr>
            );
            })()}
          </tbody>
        </table>
        </div>
        {cups.length > itemsPerPage && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              disabled={tablePage <= 1}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Page {tablePage} of {Math.max(1, Math.ceil(cups.length / itemsPerPage))} ({cups.length} total)
            </span>
            <button
              onClick={() => setTablePage((p) => Math.min(Math.ceil(cups.length / itemsPerPage), p + 1))}
              disabled={tablePage >= Math.ceil(cups.length / itemsPerPage)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>
      
      {showCreateModal && (
        <CreateCupModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={onCreateCup}
        />
      )}

      {showEditModal && (
        <EditCupModal
          cup={showEditModal}
          onClose={() => setShowEditModal(null)}
          onSubmit={(updates) => {
            onUpdateCup(showEditModal._id, updates);
            setShowEditModal(null);
          }}
        />
      )}

      {showDeleteModal && (
        <Modal isOpen={true} onClose={() => setShowDeleteModal(null)} title="Delete Cup">
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              Are you sure you want to delete <strong>{showDeleteModal.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  onDeleteCup(showDeleteModal._id);
                  setShowDeleteModal(null);
                }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setShowDeleteModal(null)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

const CreateCupModal = ({ onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    thumbnailImage: '',
    description: '',
    status: 'upcoming',
    startDate: '',
    endDate: '',
    showInNavbar: false,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Create Cup">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value, slug: e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <input
          type="text"
          placeholder="Slug"
          value={formData.slug}
          onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <ImageUpload
          label="Cup thumbnail"
          value={formData.thumbnailImage}
          onChange={(url) => setFormData({ ...formData, thumbnailImage: url })}
          folder="wergame/cups"
        />
        <textarea
          placeholder="Description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          rows="3"
        />
        <select
          value={formData.status}
          onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
        >
          <option value="upcoming">Upcoming</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
        </select>
        <div className="grid grid-cols-2 gap-4">
          <input
            type="date"
            value={formData.startDate}
            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
          <input
            type="date"
            value={formData.endDate}
            onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
        </div>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={formData.showInNavbar}
            onChange={(e) => setFormData({ ...formData, showInNavbar: e.target.checked })}
            className="mr-2"
          />
          <span className="text-gray-700 dark:text-gray-300">Show in Navbar</span>
        </label>
        <div className="flex space-x-2">
          <button type="submit" className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
            Create
          </button>
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

// Edit Cup Modal
const EditCupModal = ({ cup, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    name: cup.name || '',
    slug: cup.slug || '',
    thumbnailImage: cup.thumbnailImage || '',
    description: cup.description || '',
    status: cup.status || 'upcoming',
    startDate: cup.startDate ? new Date(cup.startDate).toISOString().split('T')[0] : '',
    endDate: cup.endDate ? new Date(cup.endDate).toISOString().split('T')[0] : '',
    showInNavbar: cup.showInNavbar || false,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Edit Cup">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <input
          type="text"
          placeholder="Slug"
          value={formData.slug}
          onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <ImageUpload
          label="Cup thumbnail"
          value={formData.thumbnailImage}
          onChange={(url) => setFormData({ ...formData, thumbnailImage: url })}
          folder="wergame/cups"
        />
        <textarea
          placeholder="Description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          rows="3"
        />
        <select
          value={formData.status}
          onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
        >
          <option value="upcoming">Upcoming</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
        </select>
        <div className="grid grid-cols-2 gap-4">
          <input
            type="date"
            value={formData.startDate}
            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
          <input
            type="date"
            value={formData.endDate}
            onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
        </div>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={formData.showInNavbar}
            onChange={(e) => setFormData({ ...formData, showInNavbar: e.target.checked })}
            className="mr-2"
          />
          <span className="text-gray-700 dark:text-gray-300">Show in Navbar</span>
        </label>
        <div className="flex space-x-2">
          <button type="submit" className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
            Update
          </button>
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

const StagesTab = ({ cups, stages, loading, tablePage, setTablePage, itemsPerPage, onCreateStage, onUpdateStage, onDeleteStage }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(null);
  const [selectedCup, setSelectedCup] = useState(null);
  const [filteredStages, setFilteredStages] = useState([]);
  const [updatingCurrentId, setUpdatingCurrentId] = useState(null);

  useEffect(() => {
    if (selectedCup) {
      setFilteredStages(stages.filter(s => s.cup?._id === selectedCup || s.cup === selectedCup));
    } else {
      setFilteredStages(stages);
    }
  }, [selectedCup, stages]);

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Stages</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Create Stage
        </button>
      </div>

      {/* Cup Filter */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Filter by Cup
        </label>
        <select
          value={selectedCup || ''}
          onChange={(e) => setSelectedCup(e.target.value || null)}
          className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
        >
          <option value="">All Cups</option>
          {cups.map((cup) => (
            <option key={cup._id} value={cup._id}>{cup.name}</option>
          ))}
        </select>
      </div>

      {/* Stages List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Order</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Cup</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Current</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Start Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">End Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {(() => {
              const paginatedStages = filteredStages.slice((tablePage - 1) * itemsPerPage, tablePage * itemsPerPage);
              return paginatedStages.map((stage) => (
              <tr key={stage._id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {stage.order}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                  {stage.name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {stage.cup?.name || 'Unknown'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {stage.isCurrent ? (
                    <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      Current
                    </span>
                  ) : (
                    <button
                      disabled={updatingCurrentId === stage._id}
                      onClick={async () => {
                        try {
                          setUpdatingCurrentId(stage._id);
                          await api.post(`/admin/stages/${stage._id}/set-current`);
                          // Refresh stages list
                          window.location.reload();
                        } catch (err) {
                          console.error('Failed to set current stage', err);
                        } finally {
                          setUpdatingCurrentId(null);
                        }
                      }}
                      className="text-xs text-blue-600 hover:text-blue-900 dark:text-blue-400 disabled:opacity-50"
                    >
                      Set Current
                    </button>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {stage.startDate ? new Date(stage.startDate).toLocaleDateString() : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {stage.endDate ? new Date(stage.endDate).toLocaleDateString() : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                  <button
                    onClick={() => setShowEditModal(stage)}
                    className="text-blue-600 hover:text-blue-900 dark:text-blue-400"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm('Are you sure you want to delete this stage?')) {
                        onDeleteStage(stage._id);
                      }
                    }}
                    className="text-red-600 hover:text-red-900 dark:text-red-400"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ));
            })()}
          </tbody>
        </table>
        </div>
        {filteredStages.length > itemsPerPage && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              disabled={tablePage <= 1}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Page {tablePage} of {Math.max(1, Math.ceil(filteredStages.length / itemsPerPage))} ({filteredStages.length} total)
            </span>
            <button
              onClick={() => setTablePage((p) => Math.min(Math.ceil(filteredStages.length / itemsPerPage), p + 1))}
              disabled={tablePage >= Math.ceil(filteredStages.length / itemsPerPage)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {filteredStages.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600 dark:text-gray-400">No stages found. Create one to get started!</p>
        </div>
      )}

      {showCreateModal && (
        <CreateStageModal
          cups={cups}
          onClose={() => setShowCreateModal(false)}
          onSubmit={onCreateStage}
        />
      )}

      {showEditModal && (
        <EditStageModal
          stage={showEditModal}
          cups={cups}
          onClose={() => setShowEditModal(null)}
          onSubmit={(updates) => {
            onUpdateStage(showEditModal._id, updates);
            setShowEditModal(null);
          }}
        />
      )}
    </div>
  );
};

const CreateStageModal = ({ cups, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    name: '',
    cup: '',
    order: 0,
    startDate: '',
    endDate: '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
    onClose();
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Create Stage" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Stage Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <select
          value={formData.cup}
          onChange={(e) => setFormData({ ...formData, cup: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        >
          <option value="">Select Cup</option>
          {cups.map((cup) => (
            <option key={cup._id} value={cup._id}>{cup.name}</option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Order"
          value={formData.order}
          onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
        />
        <div className="grid grid-cols-2 gap-4">
          <input
            type="date"
            value={formData.startDate}
            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
          <input
            type="date"
            value={formData.endDate}
            onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
        </div>
        <div className="flex space-x-2">
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Create
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

const EditStageModal = ({ stage, cups, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    name: stage.name || '',
    cup: stage.cup?._id || stage.cup || '',
    order: stage.order || 0,
    startDate: stage.startDate ? new Date(stage.startDate).toISOString().split('T')[0] : '',
    endDate: stage.endDate ? new Date(stage.endDate).toISOString().split('T')[0] : '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Edit Stage" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Stage Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <select
          value={formData.cup}
          onChange={(e) => setFormData({ ...formData, cup: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        >
          <option value="">Select Cup</option>
          {cups.map((cup) => (
            <option key={cup._id} value={cup._id}>{cup.name}</option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Order"
          value={formData.order}
          onChange={(e) => setFormData({ ...formData, order: parseInt(e.target.value) || 0 })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
        />
        <div className="grid grid-cols-2 gap-4">
          <input
            type="date"
            value={formData.startDate}
            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
          <input
            type="date"
            value={formData.endDate}
            onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
        </div>
        <div className="flex space-x-2">
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Update
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

const BlogsTab = ({ blogs, loading, tablePage, setTablePage, itemsPerPage, onCreateBlog, onUpdateBlog, onDeleteBlog }) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(null);

  if (loading) return <div className="text-center py-12">Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Blogs</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Create Blog
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Title</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Category</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Featured</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Views</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {(() => {
              const paginatedBlogs = blogs.slice((tablePage - 1) * itemsPerPage, tablePage * itemsPerPage);
              return paginatedBlogs.map((blog) => (
              <tr key={blog._id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                  {blog.title}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {blog.category}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    blog.isPublished 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                  }`}>
                    {blog.isPublished ? 'Published' : 'Draft'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {blog.isFeatured && (
                    <span className="px-2 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 rounded-full text-xs">
                      Featured
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {blog.views || 0}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                  <button
                    onClick={() => setShowEditModal(blog)}
                    className="text-blue-600 hover:text-blue-900 dark:text-blue-400"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setShowDeleteModal(blog)}
                    className="text-red-600 hover:text-red-900 dark:text-red-400"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ));
            })()}
          </tbody>
        </table>
        </div>
        {blogs.length > itemsPerPage && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              disabled={tablePage <= 1}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Page {tablePage} of {Math.max(1, Math.ceil(blogs.length / itemsPerPage))} ({blogs.length} total)
            </span>
            <button
              onClick={() => setTablePage((p) => Math.min(Math.ceil(blogs.length / itemsPerPage), p + 1))}
              disabled={tablePage >= Math.ceil(blogs.length / itemsPerPage)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {blogs.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600 dark:text-gray-400">No blogs found. Create one to get started!</p>
        </div>
      )}

      {showCreateModal && (
        <CreateBlogModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={onCreateBlog}
        />
      )}

      {showEditModal && (
        <EditBlogModal
          blog={showEditModal}
          onClose={() => setShowEditModal(null)}
          onSubmit={(updates) => {
            onUpdateBlog(showEditModal._id, updates);
            setShowEditModal(null);
          }}
        />
      )}
      
      {showDeleteModal && (
        <Modal isOpen={true} onClose={() => setShowDeleteModal(null)} title="Delete Blog">
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-gray-300">
              Are you sure you want to delete <strong>{showDeleteModal.title}</strong>? This action cannot be undone.
            </p>
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  onDeleteBlog(showDeleteModal._id);
                  setShowDeleteModal(null);
                }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setShowDeleteModal(null)}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

const CreateBlogModal = ({ onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    content: null, // Tiptap handles null/undefined gracefully
    thumbnail: '',
    category: 'General',
    tags: '',
    isFeatured: false,
    isPublished: false,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      tags: formData.tags.split(',').map(t => t.trim()).filter(t => t),
    });
    onClose();
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Create Blog" size="full">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Title"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <textarea
          placeholder="Short Description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          rows="3"
          required
        />
        <input
          type="url"
          placeholder="Thumbnail Image URL"
          value={formData.thumbnail}
          onChange={(e) => setFormData({ ...formData, thumbnail: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
        />
        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Category"
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
          <input
            type="text"
            placeholder="Tags (comma separated)"
            value={formData.tags}
            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Content
          </label>
          <BlogEditor
            value={formData.content}
            onChange={(content) => setFormData({ ...formData, content })}
          />
        </div>
        <div className="flex items-center space-x-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isFeatured}
              onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Featured</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isPublished}
              onChange={(e) => setFormData({ ...formData, isPublished: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Publish</span>
          </label>
        </div>
        <div className="flex space-x-2">
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Create
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

const EditBlogModal = ({ blog, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    title: blog.title || '',
    description: blog.description || '',
    content: blog.content || null, // Tiptap handles null/undefined gracefully
    thumbnail: blog.thumbnail || '',
    category: blog.category || 'General',
    tags: blog.tags?.join(', ') || '',
    isFeatured: blog.isFeatured || false,
    isPublished: blog.isPublished || false,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      tags: formData.tags.split(',').map(t => t.trim()).filter(t => t),
    });
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Edit Blog" size="full">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Title"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <textarea
          placeholder="Short Description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          rows="3"
          required
        />
        <input
          type="url"
          placeholder="Thumbnail Image URL"
          value={formData.thumbnail}
          onChange={(e) => setFormData({ ...formData, thumbnail: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
        />
        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Category"
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
          <input
            type="text"
            placeholder="Tags (comma separated)"
            value={formData.tags}
            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Content
          </label>
          <BlogEditor
            value={formData.content}
            onChange={(content) => setFormData({ ...formData, content })}
          />
        </div>
        <div className="flex items-center space-x-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isFeatured}
              onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Featured</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isPublished}
              onChange={(e) => setFormData({ ...formData, isPublished: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Publish</span>
          </label>
        </div>
        <div className="flex space-x-2">
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Update
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

// Simple Blog Editor wrapper for Tiptap
const BlogEditor = ({ value, onChange }) => {
  // Tiptap accepts JSON or HTML, we'll use JSON format
  // Handle conversion from old Slate format if needed
  const normalizeValue = React.useCallback((val) => {
    if (!val) {
      return null; // Tiptap handles null/undefined gracefully
    }

    // If it's already a Tiptap JSON format (has type and content properties)
    if (typeof val === 'object' && val.type) {
      return val;
    }

    // If it's a string, try to parse it
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch (e) {
        // If it's plain text, convert to Tiptap format
        return {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: val }],
            },
          ],
        };
      }
    }

    // If it's an array (old Slate format), convert to Tiptap format
    if (Array.isArray(val)) {
      const convertSlateToTiptap = (slateNodes) => {
        return slateNodes.map((node) => {
          if (node.type === 'paragraph') {
            return {
              type: 'paragraph',
              content: node.children
                ? node.children.map((child) => {
                    if (typeof child === 'string') {
                      return { type: 'text', text: child };
                    }
                    return {
                      type: 'text',
                      text: child.text || '',
                      marks: [
                        ...(child.bold ? [{ type: 'bold' }] : []),
                        ...(child.italic ? [{ type: 'italic' }] : []),
                      ],
                    };
                  })
                : [],
            };
          }
          if (node.type === 'heading-one') {
            return {
              type: 'heading',
              attrs: { level: 1 },
              content: node.children
                ? node.children.map((child) => ({
                    type: 'text',
                    text: typeof child === 'string' ? child : child.text || '',
                  }))
                : [],
            };
          }
          if (node.type === 'heading-two') {
            return {
              type: 'heading',
              attrs: { level: 2 },
              content: node.children
                ? node.children.map((child) => ({
                    type: 'text',
                    text: typeof child === 'string' ? child : child.text || '',
                  }))
                : [],
            };
          }
          if (node.type === 'heading-three') {
            return {
              type: 'heading',
              attrs: { level: 3 },
              content: node.children
                ? node.children.map((child) => ({
                    type: 'text',
                    text: typeof child === 'string' ? child : child.text || '',
                  }))
                : [],
            };
          }
          if (node.type === 'bulleted-list') {
            return {
              type: 'bulletList',
              content: node.children
                ? node.children.map((item) => ({
                    type: 'listItem',
                    content: [
                      {
                        type: 'paragraph',
                        content: item.children
                          ? item.children.map((child) => ({
                              type: 'text',
                              text: typeof child === 'string' ? child : child.text || '',
                            }))
                          : [],
                      },
                    ],
                  }))
                : [],
            };
          }
          if (node.type === 'numbered-list') {
            return {
              type: 'orderedList',
              content: node.children
                ? node.children.map((item) => ({
                    type: 'listItem',
                    content: [
                      {
                        type: 'paragraph',
                        content: item.children
                          ? item.children.map((child) => ({
                              type: 'text',
                              text: typeof child === 'string' ? child : child.text || '',
                            }))
                          : [],
                      },
                    ],
                  }))
                : [],
            };
          }
          // Default to paragraph
          return {
            type: 'paragraph',
            content: [],
          };
        });
      };

      return {
        type: 'doc',
        content: convertSlateToTiptap(val),
      };
    }

    // Return as-is if it's already a valid Tiptap format
    return val;
  }, []);

  const normalizedValue = React.useMemo(() => {
    return normalizeValue(value);
  }, [value, normalizeValue]);

  return (
    <div>
      <TiptapEditor value={normalizedValue} onChange={onChange} showToolbar />
    </div>
  );
};

const SettingsIconEdit = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const SettingsIconTrash = ({ className = 'w-4 h-4' }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const emptyNftBonus = () => ({
  id: `nft-${Date.now()}`,
  name: '',
  contractAddress: '',
  imageUrl: '',
  dailyTickets: 1,
  link: '',
  tokenStandard: 'auto',
  tokenId: '',
});

const GOLDEN_TICKET_PRESETS = ['1', '2', '3', '4', '5'];
const GOLDEN_DAY_PRESETS = ['1', '3', '7', '30'];

const resolveGoldenPresetNumber = (preset, customVal) => {
  if (preset === 'custom') {
    const n = parseInt(String(customVal || '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = parseInt(preset, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const shortAddr = (addr) => {
  if (!addr) return '—';
  const s = String(addr);
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
};

// Settings Tab Component
const NEWSLETTER_PAGE_SIZE = 20;

const NewsletterTab = () => {
  const [subscribers, setSubscribers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const { showNotification } = useNotification();

  const fetchSubscribers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/newsletter', {
        params: {
          page,
          limit: NEWSLETTER_PAGE_SIZE,
          search: search || undefined,
        },
      });
      setSubscribers(data.items || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to load subscribers', 'error');
      setSubscribers([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, showNotification]);

  useEffect(() => {
    fetchSubscribers();
  }, [fetchSubscribers]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await api.get('/admin/newsletter/export', { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `newsletter-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showNotification('Newsletter list exported', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this subscriber from the list?')) return;
    setDeletingId(id);
    try {
      await api.delete(`/admin/newsletter/${id}`);
      showNotification('Subscriber removed', 'success');
      fetchSubscribers();
    } catch (error) {
      showNotification(error.response?.data?.message || 'Delete failed', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Newsletter</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {total} subscriber{total === 1 ? '' : 's'} total
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={fetchSubscribers}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || total === 0}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSearchSubmit} className="mb-4 flex flex-col sm:flex-row gap-2">
        <input
          type="search"
          placeholder="Search by email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        />
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              setSearch('');
            }}
            className="px-4 py-2 text-sm font-medium rounded-lg text-gray-600 dark:text-gray-400 hover:underline"
          >
            Clear
          </button>
        )}
      </form>

      {loading ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading subscribers…</div>
      ) : subscribers.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          {search ? 'No subscribers match your search.' : 'No newsletter subscribers yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-left text-gray-600 dark:text-gray-400">
              <tr>
                <th className="py-3 px-4 font-medium">Email</th>
                <th className="py-3 px-4 font-medium">Source</th>
                <th className="py-3 px-4 font-medium">Subscribed</th>
                <th className="py-3 px-4 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {subscribers.map((sub) => (
                <tr key={sub._id} className="text-gray-900 dark:text-gray-100">
                  <td className="py-3 px-4 font-mono text-xs sm:text-sm">{sub.email}</td>
                  <td className="py-3 px-4 capitalize">{sub.source || '—'}</td>
                  <td className="py-3 px-4 text-gray-600 dark:text-gray-400">
                    {sub.subscribedAt
                      ? new Date(sub.subscribedAt).toLocaleString()
                      : '—'}
                  </td>
                  <td className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => handleDelete(sub._id)}
                      disabled={deletingId === sub._id}
                      className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-50"
                    >
                      {deletingId === sub._id ? '…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page >= pages || loading}
            className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

const SettingsTab = () => {
  const [dailyFreeTickets, setDailyFreeTickets] = useState(1);
  const [pointsPerWin, setPointsPerWin] = useState(10);
  const [nftBonuses, setNftBonuses] = useState([]);
  const [goldenTicketRate, setGoldenTicketRate] = useState({ tickets: 1, perUsdc: 10 });
  const [nftEditor, setNftEditor] = useState(null);
  const [giftIdentifier, setGiftIdentifier] = useState('');
  const [giftQuantityPreset, setGiftQuantityPreset] = useState('1');
  const [giftQuantityCustom, setGiftQuantityCustom] = useState('');
  const [accumIdentifier, setAccumIdentifier] = useState('');
  const [accumTicketsPreset, setAccumTicketsPreset] = useState('1');
  const [accumTicketsCustom, setAccumTicketsCustom] = useState('');
  const [accumDaysPreset, setAccumDaysPreset] = useState('7');
  const [accumDaysCustom, setAccumDaysCustom] = useState('');
  const [activeDailyGrants, setActiveDailyGrants] = useState([]);
  const [dailyGrantSearch, setDailyGrantSearch] = useState('');
  const [dailyGrantPage, setDailyGrantPage] = useState(1);
  const [submittingDailyGrant, setSubmittingDailyGrant] = useState(false);
  const [socialLinks, setSocialLinks] = useState({
    socialTwitter: '',
    socialFacebook: '',
    socialInstagram: '',
    socialYoutube: '',
  });
  const [loading, setLoading] = useState(true);
  const [savingTickets, setSavingTickets] = useState(false);
  const [savingNft, setSavingNft] = useState(false);
  const [savingGolden, setSavingGolden] = useState(false);
  const [savingSocial, setSavingSocial] = useState(false);
  const { showNotification } = useNotification();

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const [ticketsRes, pointsRes, socialRes] = await Promise.all([
        api.get('/admin/settings/dailyFreeTickets'),
        api.get('/admin/settings/pointsPerWin'),
        api.get('/admin/settings/social-links/all'),
      ]);
      setDailyFreeTickets(ticketsRes.data?.value ?? 1);
      const ppw = pointsRes.data?.value;
      setPointsPerWin(typeof ppw === 'number' ? ppw : parseInt(ppw, 10) || 10);
      if (socialRes.data) {
        setSocialLinks({
          socialTwitter: socialRes.data.socialTwitter || '',
          socialFacebook: socialRes.data.socialFacebook || '',
          socialInstagram: socialRes.data.socialInstagram || '',
          socialYoutube: socialRes.data.socialYoutube || '',
        });
      }
    } catch (error) {
      console.error('Error fetching core settings:', error);
    }
    try {
      const nftRes = await api.get('/admin/settings/nftTicketBonuses');
      const list = Array.isArray(nftRes.data?.list)
        ? nftRes.data.list
        : Array.isArray(nftRes.data?.value)
          ? nftRes.data.value
          : [];
      setNftBonuses(list.map((n, i) => ({ ...n, id: n.id || `nft-${i}` })));
    } catch (error) {
      console.error('Error fetching NFT bonuses:', error);
      setNftBonuses([]);
    }
    try {
      const [rateRes, grantsRes] = await Promise.all([
        api.get('/admin/settings/goldenTicketBoostRate'),
        api.get('/admin/users/golden-ticket-daily-grants').catch(() => ({ data: { grants: [] } })),
      ]);
      setActiveDailyGrants(grantsRes.data?.grants || []);
      const rate = rateRes.data?.rate;
      if (rate && Number(rate.perUsdc) > 0) {
        setGoldenTicketRate({
          tickets: Math.max(1, parseInt(rate.tickets, 10) || 1),
          perUsdc: Math.max(0.01, Number(rate.perUsdc) || 10),
        });
      }
    } catch (error) {
      console.error('Error fetching golden ticket rate:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveTicketSettings = async () => {
    setSavingTickets(true);
    try {
      await Promise.all([
        api.post('/admin/settings/dailyFreeTickets', { value: parseInt(dailyFreeTickets, 10) || 1 }),
        api.post('/admin/settings/pointsPerWin', { value: parseInt(pointsPerWin, 10) || 10 }),
      ]);
      showNotification('Ticket settings saved', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to save ticket settings', 'error');
    } finally {
      setSavingTickets(false);
    }
  };

  const saveNftBonuses = async () => {
    setSavingNft(true);
    try {
      const list = nftBonuses.map((n, i) => ({
        id: n.id || `nft-${i}`,
        name: String(n.name || '').trim(),
        contractAddress: String(n.contractAddress || '').trim(),
        imageUrl: n.imageUrl || '',
        dailyTickets: Math.max(0, parseInt(n.dailyTickets, 10) || 0),
        link: String(n.link || '').trim(),
        tokenStandard: String(n.tokenStandard || 'auto').trim() || 'auto',
        tokenId: n.tokenId != null && n.tokenId !== '' ? String(n.tokenId).trim() : '',
      }));
      const { data } = await api.post('/admin/settings/nftTicketBonuses', { list });
      const saved = Array.isArray(data?.list) ? data.list : list;
      setNftBonuses(saved.map((n, i) => ({ ...n, id: n.id || `nft-${i}` })));
      showNotification('NFT ticket bonuses saved', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to save NFT bonuses', 'error');
    } finally {
      setSavingNft(false);
    }
  };

  const saveGoldenTicketRate = async () => {
    setSavingGolden(true);
    try {
      const tickets = Math.max(1, parseInt(goldenTicketRate.tickets, 10) || 1);
      const perUsdc = Math.max(0.01, Number(goldenTicketRate.perUsdc) || 10);
      const { data } = await api.post('/admin/settings/goldenTicketBoostRate', { tickets, perUsdc });
      const rate = data?.rate || { tickets, perUsdc };
      setGoldenTicketRate(rate);
      showNotification('Golden ticket boost rate saved', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to save golden ticket rate', 'error');
    } finally {
      setSavingGolden(false);
    }
  };

  const saveSocialLinks = async () => {
    setSavingSocial(true);
    try {
      await api.post('/admin/settings/social-links', socialLinks);
      showNotification('Social links saved', 'success');
    } catch (error) {
      showNotification(error.response?.data?.message || 'Failed to save social links', 'error');
    } finally {
      setSavingSocial(false);
    }
  };

  const applyNftEditor = () => {
    if (!nftEditor) return;
    const { _editIndex, ...draft } = nftEditor;
    const entry = {
      ...draft,
      id: draft.id || `nft-${Date.now()}`,
      name: String(draft.name || '').trim(),
      contractAddress: String(draft.contractAddress || '').trim(),
      dailyTickets: Math.max(0, parseInt(draft.dailyTickets, 10) || 0),
      link: String(draft.link || '').trim(),
      tokenStandard: String(draft.tokenStandard || 'auto').trim() || 'auto',
      tokenId: draft.tokenId != null && draft.tokenId !== '' ? String(draft.tokenId).trim() : '',
      imageUrl: draft.imageUrl || '',
    };
    if (!entry.name && !entry.contractAddress) {
      showNotification('Name or contract address is required', 'warning');
      return;
    }
    if (_editIndex >= 0) {
      const next = [...nftBonuses];
      next[_editIndex] = entry;
      setNftBonuses(next);
    } else {
      setNftBonuses([...nftBonuses, entry]);
    }
    setNftEditor(null);
  };

  const giftGoldenTickets = async () => {
    const raw = String(giftIdentifier || '').trim();
    const qty = resolveGoldenPresetNumber(giftQuantityPreset, giftQuantityCustom);
    if (!raw) {
      showNotification('Enter user email or wallet address', 'warning');
      return;
    }
    if (!qty) {
      showNotification('Select or enter a valid ticket quantity (1 or more)', 'warning');
      return;
    }
    const body = { quantity: qty, identifier: raw };
    if (raw.includes('@')) body.email = raw;
    else body.walletAddress = raw;
    try {
      const { data } = await api.post('/admin/users/gift-golden-tickets', body);
      showNotification(
        `Gifted ${qty} golden ticket(s). New balance: ${data.goldenTickets ?? '—'}`,
        'success'
      );
      setGiftIdentifier('');
      setGiftQuantityPreset('1');
      setGiftQuantityCustom('');
    } catch (e) {
      showNotification(e.response?.data?.message || 'Gift failed', 'error');
    }
  };

  const createDailyGoldenGrant = async () => {
    const raw = String(accumIdentifier || '').trim();
    const ticketsPerDay = resolveGoldenPresetNumber(accumTicketsPreset, accumTicketsCustom);
    const days = resolveGoldenPresetNumber(accumDaysPreset, accumDaysCustom);
    if (!raw) {
      showNotification('Enter user email or wallet address', 'warning');
      return;
    }
    if (!ticketsPerDay) {
      showNotification('Select or enter tickets per day (1 or more)', 'warning');
      return;
    }
    if (!days) {
      showNotification('Select or enter number of days (1 or more)', 'warning');
      return;
    }
    const body = { ticketsPerDay, days, identifier: raw };
    if (raw.includes('@')) body.email = raw;
    else body.walletAddress = raw;
    setSubmittingDailyGrant(true);
    try {
      const { data } = await api.post('/admin/users/golden-ticket-daily-grant', body);
      showNotification(
        data.message ||
          `Scheduled ${ticketsPerDay}/day for ${days} day(s). Balance: ${data.user?.goldenTickets ?? '—'}`,
        'success'
      );
      setAccumIdentifier('');
      setAccumTicketsPreset('1');
      setAccumTicketsCustom('');
      setAccumDaysPreset('7');
      setAccumDaysCustom('');
      const grantsRes = await api.get('/admin/users/golden-ticket-daily-grants');
      setActiveDailyGrants(grantsRes.data?.grants || []);
    } catch (e) {
      showNotification(e.response?.data?.message || 'Failed to create daily grant', 'error');
    } finally {
      setSubmittingDailyGrant(false);
    }
  };

  const cancelDailyGrant = async (grantId) => {
    try {
      await api.delete(`/admin/users/golden-ticket-daily-grants/${grantId}`);
      showNotification('Daily grant schedule cancelled', 'success');
      setActiveDailyGrants((prev) => prev.filter((g) => g._id !== grantId));
    } catch (e) {
      showNotification(e.response?.data?.message || 'Cancel failed', 'error');
    }
  };

  const DAILY_GRANTS_PAGE_SIZE = 5;
  const dailyGrantQuery = String(dailyGrantSearch || '').trim().toLowerCase();
  const filteredDailyGrants = (activeDailyGrants || []).filter((g) => {
    if (!dailyGrantQuery) return true;
    const email = String(g?.user?.email || g?.recipientEmail || '').toLowerCase();
    const wallet = String(g?.recipientWallet || '').toLowerCase();
    const username = String(g?.user?.username || '').toLowerCase();
    return (
      email.includes(dailyGrantQuery) ||
      wallet.includes(dailyGrantQuery) ||
      username.includes(dailyGrantQuery)
    );
  });
  const dailyGrantTotalPages = Math.max(1, Math.ceil(filteredDailyGrants.length / DAILY_GRANTS_PAGE_SIZE));
  const safeDailyGrantPage = Math.min(Math.max(1, dailyGrantPage), dailyGrantTotalPages);
  const dailyGrantStart = (safeDailyGrantPage - 1) * DAILY_GRANTS_PAGE_SIZE;
  const pagedDailyGrants = filteredDailyGrants.slice(dailyGrantStart, dailyGrantStart + DAILY_GRANTS_PAGE_SIZE);

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Settings</h2>
      
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Ticket settings</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Daily free tickets
              </label>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                Normal tickets granted per user per day (resets, does not accumulate)
              </p>
              <input
                type="number"
                min="0"
                value={dailyFreeTickets}
                onChange={(e) => setDailyFreeTickets(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Points per Win
              </label>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                Points awarded to users for each winning prediction
              </p>
              <input
                type="number"
                min="1"
                value={pointsPerWin}
                onChange={(e) => setPointsPerWin(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                placeholder="10"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={saveTicketSettings}
            disabled={savingTickets}
            className="mt-4 px-5 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm font-semibold"
          >
            {savingTickets ? 'Saving…' : 'Save ticket settings'}
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">NFT ticket bonuses</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Shown on the free prediction page. Bonus tickets are verified on-chain for linked wallets (ERC-721 NFT, ERC-1155
            FT, or ERC-20 — use auto-detect or set token type).
          </p>
          {nftBonuses.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 mb-4">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="p-3">Collection</th>
                    <th className="p-3">Contract</th>
                    <th className="p-3 text-right">+Tickets/day</th>
                    <th className="p-3">Link</th>
                    <th className="p-3 text-right w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {nftBonuses.map((n, i) => (
                    <tr key={n.id || i} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {n.imageUrl ? (
                            <img src={n.imageUrl} alt="" className="w-9 h-9 rounded object-cover shrink-0" />
                          ) : (
                            <span className="w-9 h-9 rounded bg-gray-200 dark:bg-gray-600 shrink-0" />
                          )}
                          <span className="font-medium text-gray-900 dark:text-white">{n.name || '—'}</span>
                        </div>
                      </td>
                      <td className="p-3 font-mono text-xs text-gray-600 dark:text-gray-400" title={n.contractAddress}>
                        {shortAddr(n.contractAddress)}
                      </td>
                      <td className="p-3 text-right tabular-nums font-semibold">+{n.dailyTickets ?? 0}</td>
                      <td className="p-3 max-w-[140px] truncate">
                        {n.link ? (
                          <a href={n.link} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline text-xs">
                            View
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            title="Edit"
                            onClick={() => setNftEditor({ ...n, _editIndex: i })}
                            className="p-2 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                          >
                            <SettingsIconEdit />
                          </button>
                          <button
                            type="button"
                            title="Delete"
                            onClick={() => setNftBonuses(nftBonuses.filter((_, j) => j !== i))}
                            className="p-2 rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                          >
                            <SettingsIconTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 italic">No NFT bonuses configured yet.</p>
          )}
          {nftEditor && (
            <div className="border rounded-lg p-4 dark:border-gray-700 space-y-3 mb-4 bg-gray-50 dark:bg-gray-900/40">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {nftEditor._editIndex >= 0 ? 'Edit NFT bonus' : 'Add NFT bonus'}
              </p>
              <input
                type="text"
                placeholder="Collection name"
                value={nftEditor.name || ''}
                onChange={(e) => setNftEditor({ ...nftEditor, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
              />
              <input
                type="text"
                placeholder="Token contract address (0x…)"
                value={nftEditor.contractAddress || ''}
                onChange={(e) => setNftEditor({ ...nftEditor, contractAddress: e.target.value.trim() })}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm font-mono"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Token type</label>
                  <select
                    value={nftEditor.tokenStandard || 'auto'}
                    onChange={(e) => setNftEditor({ ...nftEditor, tokenStandard: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="erc721">ERC-721 (NFT)</option>
                    <option value="erc1155">ERC-1155 (FT)</option>
                    <option value="erc20">ERC-20 (fungible)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Token ID (ERC-1155)</label>
                  <input
                    type="text"
                    placeholder="0 (default)"
                    value={nftEditor.tokenId ?? ''}
                    onChange={(e) => setNftEditor({ ...nftEditor, tokenId: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  />
                </div>
              </div>
              <ImageUpload
                label="Image"
                value={nftEditor.imageUrl || ''}
                onChange={(url) => setNftEditor({ ...nftEditor, imageUrl: url })}
                folder="wergame/nft-bonuses"
              />
              <input
                type="number"
                min="0"
                placeholder="Daily bonus tickets"
                value={nftEditor.dailyTickets ?? ''}
                onChange={(e) => setNftEditor({ ...nftEditor, dailyTickets: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
              />
              <input
                type="url"
                placeholder="Buy / collection link"
                value={nftEditor.link || ''}
                onChange={(e) => setNftEditor({ ...nftEditor, link: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
              />
              <div className="flex gap-2">
                <button type="button" onClick={applyNftEditor} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold">
                  {nftEditor._editIndex >= 0 ? 'Update row' : 'Add to list'}
                </button>
                <button type="button" onClick={() => setNftEditor(null)} className="px-4 py-2 border rounded-lg text-sm dark:border-gray-600">
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={() => setNftEditor({ ...emptyNftBonus(), _editIndex: -1 })}
              className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold"
            >
              + Add NFT bonus
            </button>
            <button
              type="button"
              onClick={saveNftBonuses}
              disabled={savingNft}
              className="px-5 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm font-semibold"
            >
              {savingNft ? 'Saving…' : 'Save NFT ticket bonuses'}
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Golden tickets on boost</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            How many golden tickets users earn per USDC staked on boost or add-stake. Amounts are rounded to the
            nearest whole ticket (e.g. $27 at 1 per $10 → 3 tickets).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mb-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Golden tickets
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={goldenTicketRate.tickets ?? 1}
                onChange={(e) =>
                  setGoldenTicketRate((r) => ({ ...r, tickets: parseInt(e.target.value, 10) || 1 }))
                }
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Per USDC staked
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={goldenTicketRate.perUsdc ?? 10}
                onChange={(e) =>
                  setGoldenTicketRate((r) => ({ ...r, perUsdc: parseFloat(e.target.value) || 10 }))
                }
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
              />
            </div>
          </div>
          <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
            Preview:{' '}
            <strong>
              {goldenTicketRate.tickets || 1} golden ticket{(goldenTicketRate.tickets || 1) === 1 ? '' : 's'} per $
              {goldenTicketRate.perUsdc || 10} USDC
            </strong>
          </p>
          <button
            type="button"
            onClick={saveGoldenTicketRate}
            disabled={savingGolden}
            className="px-5 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 text-sm font-semibold"
          >
            {savingGolden ? 'Saving…' : 'Save golden ticket rate'}
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Send golden tickets</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            One-time grant. User receives the full amount immediately.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="text"
              placeholder="Email or wallet address (0x…)"
              value={giftIdentifier}
              onChange={(e) => setGiftIdentifier(e.target.value)}
              className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white sm:col-span-2 lg:col-span-2"
            />
            <div className="flex flex-col gap-2">
              <select
                value={giftQuantityPreset}
                onChange={(e) => setGiftQuantityPreset(e.target.value)}
                className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              >
                {GOLDEN_TICKET_PRESETS.map((n) => (
                  <option key={n} value={n}>
                    {n} golden ticket{n === '1' ? '' : 's'}
                  </option>
                ))}
                <option value="custom">Custom amount</option>
              </select>
              {giftQuantityPreset === 'custom' && (
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Custom quantity"
                  value={giftQuantityCustom}
                  onChange={(e) => setGiftQuantityCustom(e.target.value)}
                  className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                />
              )}
            </div>
            <button
              type="button"
              onClick={giftGoldenTickets}
              className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-semibold h-fit"
            >
              Send tickets
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            Golden tickets accumulate until spent. Use the user&apos;s registered email or a linked wallet address.
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Daily golden ticket accumulation
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            User receives the selected amount every UTC day for the chosen duration (first day is granted
            immediately). Example: 2 tickets for 7 days → 2 tickets today and 2 per day for 6 more days.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input
              type="text"
              placeholder="Email or wallet address (0x…)"
              value={accumIdentifier}
              onChange={(e) => setAccumIdentifier(e.target.value)}
              className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white lg:col-span-2"
            />
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Tickets per day</label>
              <select
                value={accumTicketsPreset}
                onChange={(e) => setAccumTicketsPreset(e.target.value)}
                className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              >
                {GOLDEN_TICKET_PRESETS.map((n) => (
                  <option key={n} value={n}>
                    {n} per day
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              {accumTicketsPreset === 'custom' && (
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Custom per day"
                  value={accumTicketsCustom}
                  onChange={(e) => setAccumTicketsCustom(e.target.value)}
                  className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Duration (days)</label>
              <select
                value={accumDaysPreset}
                onChange={(e) => setAccumDaysPreset(e.target.value)}
                className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              >
                {GOLDEN_DAY_PRESETS.map((n) => (
                  <option key={n} value={n}>
                    {n} day{n === '1' ? '' : 's'}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              {accumDaysPreset === 'custom' && (
                <input
                  type="number"
                  min="1"
                  step="1"
                  placeholder="Custom days"
                  value={accumDaysCustom}
                  onChange={(e) => setAccumDaysCustom(e.target.value)}
                  className="px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                />
              )}
            </div>
            <button
              type="button"
              onClick={createDailyGoldenGrant}
              disabled={submittingDailyGrant}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-semibold disabled:opacity-50 h-fit self-end"
            >
              {submittingDailyGrant ? 'Scheduling…' : 'Start daily grant'}
            </button>
          </div>

          {activeDailyGrants.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Active schedules</h4>
                <input
                  type="text"
                  placeholder="Search email or wallet…"
                  value={dailyGrantSearch}
                  onChange={(e) => {
                    setDailyGrantSearch(e.target.value);
                    setDailyGrantPage(1);
                  }}
                  className="px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm w-full sm:w-72"
                />
              </div>
              <table className="min-w-full text-sm text-left">
                <thead>
                  <tr className="border-b dark:border-gray-600 text-gray-600 dark:text-gray-400">
                    <th className="py-2 pr-4">User</th>
                    <th className="py-2 pr-4">Per day</th>
                    <th className="py-2 pr-4">Progress</th>
                    <th className="py-2 pr-4">Ends (UTC)</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {pagedDailyGrants.map((g) => (
                    <tr key={g._id} className="border-b dark:border-gray-700">
                      <td className="py-2 pr-4 text-gray-900 dark:text-white">
                        {g.user?.email || g.user?.username || g.recipientEmail || shortAddr(g.recipientWallet)}
                      </td>
                      <td className="py-2 pr-4">{g.ticketsPerDay}</td>
                      <td className="py-2 pr-4">
                        {g.daysGranted ?? 0} / {g.daysTotal}
                      </td>
                      <td className="py-2 pr-4">
                        {g.endDate ? new Date(g.endDate).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => cancelDailyGrant(g._id)}
                          className="text-red-600 hover:text-red-700 text-xs font-semibold"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {filteredDailyGrants.length === 0 ? 0 : dailyGrantStart + 1}–
                  {Math.min(dailyGrantStart + DAILY_GRANTS_PAGE_SIZE, filteredDailyGrants.length)} of{' '}
                  {filteredDailyGrants.length}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDailyGrantPage((p) => Math.max(1, p - 1))}
                    disabled={safeDailyGrantPage <= 1}
                    className="px-3 py-1.5 border rounded-lg text-xs font-semibold dark:border-gray-600 disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    Page {safeDailyGrantPage} / {dailyGrantTotalPages}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDailyGrantPage((p) => Math.min(dailyGrantTotalPages, p + 1))}
                    disabled={safeDailyGrantPage >= dailyGrantTotalPages}
                    className="px-3 py-1.5 border rounded-lg text-xs font-semibold dark:border-gray-600 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Social Media Links */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Social Media Links</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Configure social media links that appear in the navbar. Icons are always visible. Set a link to make them clickable, or leave empty to show disabled icons.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                X (Twitter) Link
              </label>
              <input
                type="text"
                value={socialLinks.socialTwitter}
                onChange={(e) => setSocialLinks({ ...socialLinks, socialTwitter: e.target.value })}
                placeholder="https://twitter.com/yourhandle or any link"
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Facebook Link
              </label>
              <input
                type="text"
                value={socialLinks.socialFacebook}
                onChange={(e) => setSocialLinks({ ...socialLinks, socialFacebook: e.target.value })}
                placeholder="https://facebook.com/yourpage or any link"
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Instagram Link
              </label>
              <input
                type="text"
                value={socialLinks.socialInstagram}
                onChange={(e) => setSocialLinks({ ...socialLinks, socialInstagram: e.target.value })}
                placeholder="https://instagram.com/yourhandle or any link"
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                YouTube Link
              </label>
              <input
                type="text"
                value={socialLinks.socialYoutube}
                onChange={(e) => setSocialLinks({ ...socialLinks, socialYoutube: e.target.value })}
                placeholder="https://youtube.com/@yourchannel or any link"
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={saveSocialLinks}
          disabled={savingSocial}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 font-semibold"
        >
          {savingSocial ? 'Saving…' : 'Save social links'}
        </button>
      </div>
    </div>
  );
};

// Edit Match Modal
const EditMatchModal = ({ match, cups, stages, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    teamA: match.teamA || '',
    teamB: match.teamB || '',
    date: match.date ? new Date(match.date).toISOString().slice(0, 16) : '',
    cup: match.cup?._id || match.cup || '',
    stage: match.stage?._id || match.stage || '',
    stageName: match.stageName || '',
    isFeatured: match.isFeatured || false,
    isSponsored: match.isSponsored || false,
    freePredictionEnabled: match.freePredictionEnabled !== false,
    marketEnabled: match.marketEnabled !== false,
    sponsoredImages: match.sponsoredImages || [],
    lockedTime: match.lockedTime ? new Date(match.lockedTime).toISOString().slice(0, 16) : '',
    teamAImage: match.teamAImage || '',
    teamBImage: match.teamBImage || '',
  });
  const [availableStages, setAvailableStages] = useState([]);

  useEffect(() => {
    if (formData.cup) {
      const selectedCup = cups.find(c => c._id === formData.cup || c.slug === formData.cup);
      if (selectedCup) {
        api.get(`/cups/${selectedCup.slug}/stages`)
          .then(response => setAvailableStages(response.data))
          .catch(() => setAvailableStages([]));
      }
    }
  }, [formData.cup, cups]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const selectedStage = availableStages.find(s => s._id === formData.stage);
    onSubmit({
      ...formData,
      stageName: selectedStage?.name || formData.stageName,
    });
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Edit Match" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <input
              type="text"
              placeholder="Team A"
              value={formData.teamA}
              onChange={(e) => setFormData({ ...formData, teamA: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white mb-2"
              required
            />
            <ImageUpload
              label="Team A Image"
              value={formData.teamAImage}
              onChange={(url) => setFormData({ ...formData, teamAImage: url })}
              folder="wergame/teams"
            />
          </div>
          <div>
            <input
              type="text"
              placeholder="Team B"
              value={formData.teamB}
              onChange={(e) => setFormData({ ...formData, teamB: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white mb-2"
              required
            />
            <ImageUpload
              label="Team B Image"
              value={formData.teamBImage}
              onChange={(url) => setFormData({ ...formData, teamBImage: url })}
              folder="wergame/teams"
            />
          </div>
        </div>
        <input
          type="datetime-local"
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <select
          value={formData.cup}
          onChange={(e) => setFormData({ ...formData, cup: e.target.value, stage: '' })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        >
          <option value="">Select Cup</option>
          {cups.map((cup) => (
            <option key={cup._id} value={cup._id}>{cup.name}</option>
          ))}
        </select>
        {formData.cup && availableStages.length > 0 && (
          <select
            value={formData.stage}
            onChange={(e) => {
              const selectedStage = availableStages.find(s => s._id === e.target.value);
              setFormData({ ...formData, stage: e.target.value, stageName: selectedStage?.name || '' });
            }}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          >
            <option value="">Select Stage</option>
            {availableStages.map((stage) => (
              <option key={stage._id} value={stage._id}>{stage.name}</option>
            ))}
          </select>
        )}
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isFeatured}
              onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Featured Match</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isSponsored}
              onChange={(e) => setFormData({ ...formData, isSponsored: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Sponsored Match</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.freePredictionEnabled}
              onChange={(e) => setFormData({ ...formData, freePredictionEnabled: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Free prediction enabled</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.marketEnabled}
              onChange={(e) => setFormData({ ...formData, marketEnabled: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Market enabled</span>
          </label>
        </div>
        
        {/* Sponsored Images - Show when sponsored is checked */}
        {formData.isSponsored && (
          <div className="border p-4 rounded-lg dark:border-gray-700">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Sponsored Images (optional)
            </label>
            <div className="space-y-2">
              {formData.sponsoredImages.map((img, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <img src={img} alt={`Sponsor ${idx + 1}`} className="w-16 h-16 object-cover rounded-lg" />
                  <button
                    type="button"
                    onClick={() => {
                      const newImages = formData.sponsoredImages.filter((_, i) => i !== idx);
                      setFormData({ ...formData, sponsoredImages: newImages });
                    }}
                    className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <ImageUpload
                label="Add Sponsored Image"
                value=""
                onChange={(url) => {
                  if (url) {
                    setFormData({ ...formData, sponsoredImages: [...formData.sponsoredImages, url] });
                  }
                }}
                folder="wergame/sponsored"
              />
            </div>
          </div>
        )}

        {/* Locked Time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Locked Time (optional) - When predictions should be locked
          </label>
          <input
            type="datetime-local"
            value={formData.lockedTime}
            onChange={(e) => setFormData({ ...formData, lockedTime: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div className="flex space-x-2">
          <button type="submit" className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
            Update
          </button>
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

// Add Liquidity Modal for Match (YES / NO per outcome, single batched on-chain tx)
const AddLiquidityModal = ({ match, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    teamAYes: '',
    teamANo: '',
    teamBYes: '',
    teamBNo: '',
    drawYes: '',
    drawNo: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      await onSubmit({
        teamAYes: parseFloat(formData.teamAYes) || 0,
        teamANo: parseFloat(formData.teamANo) || 0,
        teamBYes: parseFloat(formData.teamBYes) || 0,
        teamBNo: parseFloat(formData.teamBNo) || 0,
        drawYes: parseFloat(formData.drawYes) || 0,
        drawNo: parseFloat(formData.drawNo) || 0,
      });
      onClose();
    } catch (error) {
      console.error('Error in add liquidity modal:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const row = (label, yesKey, noKey) => (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label} — YES (USDC)</label>
        <input
          type="number"
          step="0.01"
          value={formData[yesKey]}
          onChange={(e) => setFormData({ ...formData, [yesKey]: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
          placeholder="0"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{label} — NO (USDC)</label>
        <input
          type="number"
          step="0.01"
          value={formData[noKey]}
          onChange={(e) => setFormData({ ...formData, [noKey]: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
          placeholder="0"
        />
      </div>
    </div>
  );

  return (
    <Modal isOpen={true} onClose={onClose} title={`Add Liquidity - ${match.teamA} vs ${match.teamB}`} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Initial pools are credited in one batched contract call (orderbook reference liquidity).
        </p>
        {row(match.teamA || 'Team A', 'teamAYes', 'teamANo')}
        {row(match.teamB || 'Team B', 'teamBYes', 'teamBNo')}
        {row('Draw', 'drawYes', 'drawNo')}
        <div className="flex space-x-2 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Submitting…' : 'Add Liquidity'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

// Edit Poll Modal
const EditPollModal = ({ poll, cups, onClose, onSubmit }) => {
  // USDC ~ USD; no price API needed
  const liqMap = new Map(
    (poll?.orderbook?.liquidityYesNo || []).map((x) => [String(x?.optionKey || '').trim(), { yes: x?.yes || 0, no: x?.no || 0 }])
  );
  const [formData, setFormData] = useState({
    question: poll.question || '',
    thumbnailImage: poll.thumbnailImage || '',
    description: poll.description || '',
    type: poll.type || 'match',
    cup: poll.cup?._id || poll.cup || '',
    isFeatured: poll.isFeatured || false,
    isSponsored: poll.isSponsored || false,
    freePredictionEnabled: poll.freePredictionEnabled !== false,
    marketEnabled: poll.marketEnabled !== false,
    sponsoredImages: poll.sponsoredImages || [],
    date: utcIsoToDatetimeLocal(poll.date || poll.createdAt),
    lockedTime: poll.lockedTime ? new Date(poll.lockedTime).toISOString().slice(0, 16) : '',
    optionType: 'options',
    options: poll.options
      ? poll.options.map((opt) => {
          const key = String(opt?.text || '').trim();
          const seed = liqMap.get(key) || { yes: 0, no: 0 };
          return {
            text: opt.text || '',
            image: opt.image || '',
            yesLiquidity: seed.yes || '',
            noLiquidity: seed.no || '',
          };
        })
      : [],
  });

  const addOption = () => {
    setFormData({
      ...formData,
      options: [...formData.options, { text: '', image: '', yesLiquidity: '', noLiquidity: '' }],
    });
  };

  const removeOption = (index) => {
    const newOptions = formData.options.filter((_, i) => i !== index);
    setFormData({ ...formData, options: newOptions });
  };

  const updateOption = (index, field, value) => {
    const newOptions = [...formData.options];
    newOptions[index] = { ...newOptions[index], [field]: value };
    setFormData({ ...formData, options: newOptions });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const submitData = { ...formData };
    
    submitData.optionType = 'options';
    submitData.options = formData.options.map((opt) => ({
      text: String(opt.text || '').trim(),
      image: opt.image || undefined,
      yesLiquidity: parseFloat(opt.yesLiquidity) || 0,
      noLiquidity: parseFloat(opt.noLiquidity) || 0,
    }));

    submitData.date = utcDatetimeLocalToIso(formData.date);
    
    onSubmit(submitData);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Edit Poll" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="text"
          placeholder="Question"
          value={formData.question}
          onChange={(e) => setFormData({ ...formData, question: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        />
        <ImageUpload
          label="Poll thumbnail"
          value={formData.thumbnailImage}
          onChange={(url) => setFormData({ ...formData, thumbnailImage: url })}
          folder="wergame/polls"
        />
        <textarea
          placeholder="Description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          rows="3"
        />
        <select
          value={formData.type}
          onChange={(e) => setFormData({ ...formData, type: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
        >
          <option value="match">Match</option>
          <option value="team">Team</option>
          <option value="stage">Stage</option>
          <option value="award">Award</option>
        </select>
        <select
          value={formData.cup}
          onChange={(e) => setFormData({ ...formData, cup: e.target.value })}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          required
        >
          <option value="">Select Cup</option>
          {cups.map((cup) => (
            <option key={cup._id} value={cup._id}>{cup.name}</option>
          ))}
        </select>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Event date &amp; time (GMT)
          </label>
          <input
            type="datetime-local"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Enter the wall time in GMT — this is exactly what users will see.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.freePredictionEnabled}
              onChange={(e) => setFormData({ ...formData, freePredictionEnabled: e.target.checked })}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Free prediction enabled</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.marketEnabled}
              onChange={(e) => setFormData({ ...formData, marketEnabled: e.target.checked })}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Market enabled</span>
          </label>
        </div>
        
        {/* Poll Options (option-based only) */}
        <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Poll Options
              </label>
              <button
                type="button"
                onClick={addOption}
                className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
              >
                + Add Option
              </button>
            </div>
            {formData.options.map((option, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Option {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-xs"
                  >
                    Remove
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Option text"
                  value={option.text}
                  onChange={(e) => updateOption(index, 'text', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                  required
                />
                <ImageUpload
                  label="Option Image"
                  value={option.image}
                  onChange={(url) => updateOption(index, 'image', url)}
                  folder="wergame/poll-options"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      YES liquidity (USDC)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={option.yesLiquidity}
                      onChange={(e) => updateOption(index, 'yesLiquidity', e.target.value)}
                      className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      NO liquidity (USDC)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0"
                      value={option.noLiquidity}
                      onChange={(e) => updateOption(index, 'noLiquidity', e.target.value)}
                      className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Total: {formatUsdAmount((parseFloat(option.yesLiquidity) || 0) + (parseFloat(option.noLiquidity) || 0))}
                </p>
              </div>
            ))}
            {formData.options.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                Click "Add Option" to create poll options
              </p>
            )}
          </div>
        
        <div className="space-y-3">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isFeatured}
              onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Featured Poll</span>
          </label>
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.isSponsored}
              onChange={(e) => setFormData({ ...formData, isSponsored: e.target.checked })}
              className="mr-2"
            />
            <span className="text-gray-700 dark:text-gray-300">Sponsored Poll</span>
          </label>
        </div>
        
        {/* Sponsored Images - Show when sponsored is checked */}
        {formData.isSponsored && (
          <div className="border p-4 rounded-lg dark:border-gray-700">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Sponsored Images (optional)
            </label>
            <div className="space-y-2">
              {formData.sponsoredImages.map((img, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <img src={img} alt={`Sponsor ${idx + 1}`} className="w-16 h-16 object-cover rounded-lg" />
                  <button
                    type="button"
                    onClick={() => {
                      const newImages = formData.sponsoredImages.filter((_, i) => i !== idx);
                      setFormData({ ...formData, sponsoredImages: newImages });
                    }}
                    className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <ImageUpload
                label="Add Sponsored Image"
                value=""
                onChange={(url) => {
                  if (url) {
                    setFormData({ ...formData, sponsoredImages: [...formData.sponsoredImages, url] });
                  }
                }}
                folder="wergame/sponsored"
              />
            </div>
          </div>
        )}

        {/* Locked Time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Locked Time (optional) - When predictions should be locked
          </label>
          <input
            type="datetime-local"
            value={formData.lockedTime}
            onChange={(e) => setFormData({ ...formData, lockedTime: e.target.value })}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
          />
        </div>

        <div className="flex space-x-2">
          <button type="submit" className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
            Update
          </button>
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

// Poll Status Modal
const PollStatusModal = ({ poll, onClose, onSubmit }) => {
  const [status, setStatus] = useState(poll.status);

  const handleSubmit = (e) => {
    e.preventDefault();
    const updates = { status };
    // If status is set to locked, immediately lock (override any locked time)
    if (status === 'locked') {
      updates.lockedTime = new Date().toISOString();
    }
    onSubmit(poll._id, updates);
    onClose();
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Update Poll Status">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
            required
          >
            <option value="upcoming">Upcoming</option>
            <option value="active">Active</option>
            <option value="locked">Locked</option>
            <option value="settled">Settled</option>
          </select>
          {status === 'locked' && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              Setting status to "Locked" will immediately lock predictions for this poll.
            </p>
          )}
        </div>
        <div className="flex space-x-2">
          <button type="submit" className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
            Update
          </button>
          <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

// Add Liquidity Modal for Poll
const AddPollLiquidityModal = ({ poll, onClose, onSubmit }) => {
  // USDC ~ USD; no price API needed
  const [formData, setFormData] = useState({
    optionIndex: '',
    optionYes: '',
    optionNo: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      await onSubmit({
        optionIndex: parseInt(formData.optionIndex, 10),
        optionYes: parseFloat(formData.optionYes) || 0,
        optionNo: parseFloat(formData.optionNo) || 0,
      });
      // Only close modal after successful submission
      onClose();
    } catch (error) {
      // Error already handled in onSubmit, just don't close modal
      console.error('Error in add poll liquidity modal:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`Add Liquidity - ${poll.question}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select Option
            </label>
            <select
              value={formData.optionIndex}
              onChange={(e) => setFormData({ ...formData, optionIndex: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              required
            >
              <option value="">Select an option</option>
              {poll.options && poll.options.map((option, index) => (
                <option key={index} value={index}>
                  {option.text}
                </option>
              ))}
            </select>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  YES side (USDC)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.optionYes}
                  onChange={(e) => setFormData({ ...formData, optionYes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  NO side (USDC)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.optionNo}
                  onChange={(e) => setFormData({ ...formData, optionNo: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:text-white text-sm"
                  placeholder="0"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Batched on-chain via <code className="text-xs">batchAddOrderbookLiquidity</code>.
            </p>
          </div>
        <div className="flex space-x-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Submitting…' : 'Add Liquidity'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default Admin;
