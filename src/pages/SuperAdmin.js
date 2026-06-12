import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import Modal from '../components/Modal';
import { useNotification } from '../components/Notification';
import { useWallet } from '../context/WalletContext';
import { getBlockExplorerTxUrl } from '../utils/chainParams';
import { formatUsdAmount } from '../utils/money';
import {
  setFees as setFeesOnChain,
  getFees as getFeesFromChain,
  getContractBalance as getContractBalanceFromChain,
  transferFunds as transferFundsOnChain,
  fundJackpotPool,
  withdrawFromJackpotPool,
  setSuperAdmin as setSuperAdminOnChain,
  setContractAddress,
  getJackpotPoolBalance,
  getClaimPredictionWinsPoolBalance,
  getTreasurySnapshot,
  fundClaimPredictionWinsPool,
  withdrawFromClaimPredictionWinsPool,
  migrateAllFundsForUpgrade,
  ensureWalletConnected,
  getClaimAuthSigner,
  setClaimAuthSigner,
  setAdmin,
  isOnChainAdmin,
} from '../utils/blockchain';

const ITEMS_PER_PAGE = 20;

const SuperAdmin = () => {
  const [activeTab, setActiveTab] = useState('fees');
  const [feeSettings, setFeeSettings] = useState({
    platformFee: '',
    marketPlatformFee: '',
    freeJackpotFee: '',
  });
  const [contractBalance, setContractBalance] = useState('');
  const [treasuryUnallocated, setTreasuryUnallocated] = useState('');
  const [treasuryVaultLiabilities, setTreasuryVaultLiabilities] = useState('');
  const [treasuryMaxRoutineTransfer, setTreasuryMaxRoutineTransfer] = useState('');
  const [migrationTo, setMigrationTo] = useState('');
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [jackpotPoolBalance, setJackpotPoolBalance] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [superAdminAddress, setSuperAdminAddress] = useState('');
  const [adminToSet, setAdminToSet] = useState('');
  const [adminEnabled, setAdminEnabled] = useState(true);
  const [adminStatus, setAdminStatus] = useState(null); // null | boolean
  const [adminUpdating, setAdminUpdating] = useState(false);
  const [matches, setMatches] = useState([]);
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalContent, setModalContent] = useState({ title: '', message: '', type: 'success' });
  const [jackpotFundAmount, setJackpotFundAmount] = useState('');
  const [jackpotWithdrawAmount, setJackpotWithdrawAmount] = useState('');
  const [jackpotWithdrawTo, setJackpotWithdrawTo] = useState('');
  const [claimPredictionWinsPoolBalance, setClaimPredictionWinsPoolBalance] = useState('');
  const [claimPoolFundAmount, setClaimPoolFundAmount] = useState('');
  const [claimPoolWithdrawAmount, setClaimPoolWithdrawAmount] = useState('');
  const [claimPoolWithdrawTo, setClaimPoolWithdrawTo] = useState('');
  const [claimSignerOnChain, setClaimSignerOnChain] = useState('');
  const [claimSignerFromApi, setClaimSignerFromApi] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [txRows, setTxRows] = useState([]);
  const [txPage, setTxPage] = useState(1);
  const [txTotalPages, setTxTotalPages] = useState(1);
  const [txTotal, setTxTotal] = useState(0);
  const [txLoading, setTxLoading] = useState(false);
  const { showNotification } = useNotification();
  const { account, connect, isBaseSepolia } = useWallet();
  // USDC ~ USD; display $ directly

  const [mmBotWallet, setMmBotWallet] = useState('');
  const [mmBotUserId, setMmBotUserId] = useState('');
  const [mmBotSaving, setMmBotSaving] = useState(false);

  const refreshMmBotActor = async () => {
    try {
      const { data } = await api.get('/admin/orderbook/mm-actor');
      setMmBotWallet(data?.walletAddress || '');
      setMmBotUserId(data?.userId || '');
    } catch {
      setMmBotWallet('');
      setMmBotUserId('');
    }
  };

  const saveMmBotActor = async () => {
    const w = String(mmBotWallet || '').trim();
    if (!w) {
      showNotification('Enter a bot wallet address', 'warning');
      return;
    }
    setMmBotSaving(true);
    try {
      const { data } = await api.put('/admin/orderbook/mm-actor', { walletAddress: w });
      setMmBotWallet(data?.walletAddress || w);
      setMmBotUserId(data?.userId || '');
      showNotification('Market maker bot wallet updated', 'success');
    } catch (e) {
      showNotification(e?.response?.data?.message || e?.message || 'Failed to save bot wallet', 'error');
    } finally {
      setMmBotSaving(false);
    }
  };

  useEffect(() => {
    setTablePage(1);
    setTxPage(1);
  }, [activeTab]);

  const ZERO = '0x0000000000000000000000000000000000000000';

  const refreshClaimSignerStatus = async () => {
    try {
      const { data } = await api.get('/config/claim');
      setClaimSignerFromApi(data.claimSignerAddress || '');
    } catch {
      setClaimSignerFromApi('');
    }
    try {
      const addr = await getClaimAuthSigner();
      setClaimSignerOnChain(addr ? String(addr) : '');
    } catch {
      setClaimSignerOnChain('');
    }
  };

  useEffect(() => {
    if (activeTab === 'contract') {
      refreshClaimSignerStatus();
    }
  }, [activeTab]);

  const handleSetClaimAuthSignerOnChain = async () => {
    try {
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base in your wallet', 'error');
      return;
    }
    if (!claimSignerFromApi) {
      showNotification(
        'API has no claim signer (set CLAIM_AUTH_PRIVATE_KEY on the backend and restart)',
        'error'
      );
      return;
    }
    try {
      const txHash = await setClaimAuthSigner(claimSignerFromApi);
      showNotification(`Claim signer set on-chain. TX: ${txHash.slice(0, 10)}...`, 'success');
      await logTx({
        action: 'set_claim_auth_signer',
        txHash,
        meta: { address: claimSignerFromApi },
      });
      await refreshClaimSignerStatus();
    } catch (error) {
      console.error('setClaimAuthSigner:', error);
      showModalMessage('Error', error.message || 'Failed to set claim signer', 'error');
    }
  };
  
  // Set contract address on mount (should be from env or config)
  useEffect(() => {
    const contractAddr = process.env.REACT_APP_CONTRACT_ADDRESS;
    if (contractAddr) {
      setContractAddress(contractAddr);
    }
  }, []);

  const showModalMessage = (title, message, type = 'success') => {
    setModalContent({ title, message, type });
    setShowModal(true);
  };

  const logTx = async ({ action, txHash, ethAmount, meta }) => {
    try {
      const ethAmountNum =
        ethAmount === undefined || ethAmount === null || ethAmount === ''
          ? undefined
          : Number(ethAmount);
      const usdAmount =
        ethAmountNum != null && !Number.isNaN(ethAmountNum)
          ? Number(ethAmountNum)
          : undefined;
      await api.post('/superadmin/transactions', {
        action,
        txHash,
        ethAmount: ethAmountNum,
        usdAmount,
        ethUsd: 1,
        meta: meta || {},
      });
    } catch (e) {
      // Logging must never block admin actions
      console.warn('Failed to log super admin transaction:', e?.message || e);
    }
  };

  const fetchTransactions = async (page = txPage) => {
    setTxLoading(true);
    try {
      const { data } = await api.get('/superadmin/transactions', {
        params: { page, limit: ITEMS_PER_PAGE },
      });
      setTxRows(data?.rows || []);
      setTxPage(data?.page || page);
      setTxTotalPages(data?.totalPages || 1);
      setTxTotal(data?.total || 0);
    } catch (error) {
      showModalMessage('Error', error.response?.data?.message || 'Failed to fetch transactions', 'error');
      setTxRows([]);
      setTxTotalPages(1);
      setTxTotal(0);
    } finally {
      setTxLoading(false);
    }
  };

  const handleSetFees = async () => {
    try {
      // Connect wallet and switch to Base if needed (pops wallet)
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base in your wallet', 'error');
      return;
    }
    try {
      // First, set fees on blockchain
      const txHash = await setFeesOnChain(
        parseFloat(feeSettings.platformFee || 0),
        0,
        parseFloat(feeSettings.marketPlatformFee || 0),
        parseFloat(feeSettings.freeJackpotFee || 0)
      );
      showNotification(`Fees set on blockchain! TX: ${txHash.slice(0, 10)}...`, 'success');
      await logTx({
        action: 'set_fees',
        txHash,
        meta: { ...feeSettings },
      });
      
      // Then update backend
      await api.post('/superadmin/set-fees', feeSettings);
      showModalMessage('Success', 'Fees updated successfully on blockchain and backend!', 'success');
      await handleGetFees();
    } catch (error) {
      console.error('Error setting fees:', error);
      showModalMessage('Error', error.message || 'Failed to set fees', 'error');
    }
  };

  const handleGetFees = async () => {
    try {
      // Try to get from blockchain first
      try {
        const chainFees = await getFeesFromChain();
        setFeeSettings(chainFees);
        showNotification('Fees loaded from blockchain', 'success');
      } catch (chainError) {
        console.log('Could not get fees from chain, using backend:', chainError);
        // Fallback to backend
        const response = await api.get('/superadmin/get-fees');
        setFeeSettings(response.data);
      }
    } catch (error) {
      showModalMessage('Error', error.response?.data?.message || 'Failed to get fees', 'error');
    }
  };

  const handleGetBalance = async () => {
    try {
      // Get from blockchain
      const balance = await getContractBalanceFromChain();
      setContractBalance(balance);
      try {
        const snap = await getTreasurySnapshot();
        const total = parseFloat(snap.usdcBalance) || 0;
        const claim = parseFloat(snap.claimPoolBalance) || 0;
        const jack = parseFloat(snap.jackpotPoolBalance) || 0;
        const vault = parseFloat(snap.tradingVaultLiabilities) || 0;
        const maxRoutine = parseFloat(snap.maxRoutineTransfer) || 0;
        const unalloc = Math.max(0, total - claim - jack - vault);
        setTreasuryUnallocated(Number.isFinite(unalloc) ? unalloc.toFixed(6) : '');
        setTreasuryVaultLiabilities(Number.isFinite(vault) ? vault.toFixed(6) : '');
        setTreasuryMaxRoutineTransfer(Number.isFinite(maxRoutine) ? maxRoutine.toFixed(6) : '');
      } catch (treasuryErr) {
        console.error('Error getting treasury snapshot:', treasuryErr);
        setTreasuryUnallocated('');
        setTreasuryVaultLiabilities('');
        setTreasuryMaxRoutineTransfer('');
      }

      // Also get jackpot pool balance
      try {
        const jackpotBalance = await getJackpotPoolBalance();
        setJackpotPoolBalance(jackpotBalance);
      } catch (jackpotError) {
        console.error('Error getting jackpot pool balance:', jackpotError);
      }
      // Get claim prediction wins pool balance
      try {
        const claimPoolBalance = await getClaimPredictionWinsPoolBalance();
        setClaimPredictionWinsPoolBalance(claimPoolBalance);
      } catch (claimPoolError) {
        console.error('Error getting claim prediction wins pool balance:', claimPoolError);
      }
      showNotification('Balance loaded from blockchain', 'success');
    } catch (error) {
      console.error('Error getting balance:', error);
      showModalMessage('Error', error.message || 'Failed to get balance', 'error');
    }
  };

  const handleTransfer = async () => {
    try {
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base in your wallet', 'error');
      return;
    }
    const amount = parseFloat(transferAmount);
    const maxRoutine = parseFloat(treasuryMaxRoutineTransfer);
    if (!Number.isFinite(amount) || amount <= 0) {
      showNotification('Enter a valid transfer amount', 'warning');
      return;
    }
    if (Number.isFinite(maxRoutine) && amount > maxRoutine + 1e-9) {
      showNotification(
        `Amount exceeds routine transfer limit (${treasuryMaxRoutineTransfer || '0'} USDC). Use "Migrate all funds" for a full upgrade drain.`,
        'warning'
      );
      return;
    }
    try {
      // Transfer on blockchain first
      const txHash = await transferFundsOnChain(transferTo, parseFloat(transferAmount));
      showNotification(`Transfer successful! TX: ${txHash.slice(0, 10)}...`, 'success');
      await logTx({
        action: 'transfer_funds',
        txHash,
        ethAmount: transferAmount,
        meta: { to: transferTo },
      });
      
      // Update backend if needed
      await api.post('/superadmin/transfer', {
        to: transferTo,
        amount: transferAmount,
      });
      
      showModalMessage('Success', 'Transfer successful on blockchain!', 'success');
      setTransferAmount('');
      setTransferTo('');
      await handleGetBalance();
    } catch (error) {
      console.error('Error transferring:', error);
      showModalMessage('Error', error.message || 'Transfer failed', 'error');
    }
  };

  const handleMigrateAllFunds = async () => {
    const to = migrationTo.trim();
    if (!to) {
      showNotification('Enter migration recipient address', 'warning');
      return;
    }
    if (!window.confirm(
      'This withdraws ALL USDC from the contract and resets pool accounting. Only use when upgrading to a new contract. Users must use the new deployment afterward. Continue?'
    )) {
      return;
    }
    try {
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base in your wallet', 'error');
      return;
    }
    setMigrationLoading(true);
    try {
      const txHash = await migrateAllFundsForUpgrade(to);
      showNotification(`Migration withdraw complete! TX: ${txHash.slice(0, 10)}…`, 'success');
      await logTx({
        action: 'migrate_all_funds_for_upgrade',
        txHash,
        meta: { to },
      });
      setMigrationTo('');
      await handleGetBalance();
    } catch (error) {
      console.error('Migration withdraw failed:', error);
      showModalMessage('Error', error.message || 'Migration withdraw failed', 'error');
    } finally {
      setMigrationLoading(false);
    }
  };

  const handleFundJackpotPool = async () => {
    // Wallet will auto-connect when blockchain function is called
    
    try {
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base in your wallet', 'error');
      return;
    }
    if (!jackpotFundAmount || parseFloat(jackpotFundAmount) <= 0) {
      showNotification('Please enter a valid amount', 'warning');
      return;
    }
    
    try {
      const txHash = await fundJackpotPool(parseFloat(jackpotFundAmount));
      showNotification(`Jackpot pool funded! TX: ${txHash.slice(0, 10)}...`, 'success');
      await logTx({
        action: 'fund_jackpot_pool',
        txHash,
        ethAmount: jackpotFundAmount,
      });
      setJackpotFundAmount('');
      await handleGetBalance(); // This will also refresh jackpot pool balance
    } catch (error) {
      console.error('Error funding jackpot pool:', error);
      showNotification(error.message || 'Failed to fund jackpot pool', 'error');
    }
  };
  
  const handleWithdrawFromJackpotPool = async () => {
    try {
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base in your wallet', 'error');
      return;
    }
    if (!jackpotWithdrawAmount || parseFloat(jackpotWithdrawAmount) <= 0) {
      showNotification('Please enter a valid amount', 'warning');
      return;
    }
    
    if (!jackpotWithdrawTo) {
      showNotification('Please enter a recipient address', 'warning');
      return;
    }
    
    try {
      const txHash = await withdrawFromJackpotPool(jackpotWithdrawTo, parseFloat(jackpotWithdrawAmount));
      showNotification(`Withdrawn from jackpot pool! TX: ${txHash.slice(0, 10)}...`, 'success');
      await logTx({
        action: 'withdraw_jackpot_pool',
        txHash,
        ethAmount: jackpotWithdrawAmount,
        meta: { to: jackpotWithdrawTo },
      });
      setJackpotWithdrawAmount('');
      setJackpotWithdrawTo('');
      await handleGetBalance();
    } catch (error) {
      console.error('Error withdrawing from jackpot pool:', error);
      showNotification(error.message || 'Failed to withdraw from jackpot pool', 'error');
    }
  };

  const handleFundClaimPredictionWinsPool = async () => {
    try {
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base in your wallet', 'error');
      return;
    }
    if (!claimPoolFundAmount || parseFloat(claimPoolFundAmount) <= 0) {
      showNotification('Please enter a valid amount', 'warning');
      return;
    }
    try {
      const txHash = await fundClaimPredictionWinsPool(parseFloat(claimPoolFundAmount));
      showNotification(`Claim prediction wins pool funded! TX: ${txHash.slice(0, 10)}...`, 'success');
      await logTx({
        action: 'fund_claim_prediction_wins_pool',
        txHash,
        ethAmount: claimPoolFundAmount,
      });
      setClaimPoolFundAmount('');
      await handleGetBalance();
    } catch (error) {
      console.error('Error funding claim prediction wins pool:', error);
      showNotification(error.message || 'Failed to fund claim prediction wins pool', 'error');
    }
  };

  const handleWithdrawFromClaimPredictionWinsPool = async () => {
    try {
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base in your wallet', 'error');
      return;
    }
    if (!claimPoolWithdrawAmount || parseFloat(claimPoolWithdrawAmount) <= 0) {
      showNotification('Please enter a valid amount', 'warning');
      return;
    }
    if (!claimPoolWithdrawTo?.trim()) {
      showNotification('Please enter a recipient address', 'warning');
      return;
    }
    try {
      const txHash = await withdrawFromClaimPredictionWinsPool(claimPoolWithdrawTo.trim(), parseFloat(claimPoolWithdrawAmount));
      showNotification(`Withdrawn from claim prediction wins pool! TX: ${txHash.slice(0, 10)}...`, 'success');
      await logTx({
        action: 'withdraw_claim_prediction_wins_pool',
        txHash,
        ethAmount: claimPoolWithdrawAmount,
        meta: { to: claimPoolWithdrawTo.trim() },
      });
      setClaimPoolWithdrawAmount('');
      setClaimPoolWithdrawTo('');
      await handleGetBalance();
    } catch (error) {
      console.error('Error withdrawing from claim prediction wins pool:', error);
      showNotification(error.message || 'Failed to withdraw from claim prediction wins pool', 'error');
    }
  };

  const handleSetSuperAdmin = async () => {
    try {
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base in your wallet', 'error');
      return;
    }
    try {
      // Set on blockchain first
      const txHash = await setSuperAdminOnChain(superAdminAddress);
      showNotification(`SuperAdmin set on blockchain! TX: ${txHash.slice(0, 10)}...`, 'success');
      await logTx({
        action: 'set_super_admin',
        txHash,
        meta: { address: superAdminAddress },
      });
      
      // Update backend if needed
      await api.post('/superadmin/set-superadmin', {
        address: superAdminAddress,
      });
      
      showModalMessage('Success', 'SuperAdmin address set successfully on blockchain!', 'success');
      setSuperAdminAddress('');
    } catch (error) {
      console.error('Error setting superAdmin:', error);
      showModalMessage('Error', error.message || 'Failed to set SuperAdmin', 'error');
    }
  };

  const refreshAdminStatus = async (addr) => {
    const a = (addr || '').trim();
    if (!a) {
      setAdminStatus(null);
      return;
    }
    const ok = await isOnChainAdmin(a);
    setAdminStatus(ok);
  };

  const handleSetAdmin = async () => {
    try {
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base in your wallet', 'error');
      return;
    }
    if (!adminToSet || !adminToSet.trim()) {
      showNotification('Please enter an admin wallet address', 'warning');
      return;
    }
    setAdminUpdating(true);
    try {
      const txHash = await setAdmin(adminToSet.trim(), adminEnabled);
      showNotification(`Admin updated on-chain. TX: ${txHash.slice(0, 10)}...`, 'success');
      await logTx({
        action: adminEnabled ? 'set_admin_enabled' : 'set_admin_disabled',
        txHash,
        meta: { address: adminToSet.trim(), enabled: !!adminEnabled },
      });
      await refreshAdminStatus(adminToSet.trim());
    } catch (error) {
      console.error('setAdmin:', error);
      showModalMessage('Error', error?.message || 'Failed to set admin', 'error');
    } finally {
      setAdminUpdating(false);
    }
  };

  const fetchMatches = async () => {
    setLoading(true);
    try {
      const response = await api.get('/superadmin/matches');
      setMatches(response.data || []);
    } catch (error) {
      showModalMessage('Error', 'Failed to fetch matches', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchPolls = async () => {
    setLoading(true);
    try {
      const response = await api.get('/superadmin/polls');
      setPolls(response.data || []);
    } catch (error) {
      showModalMessage('Error', 'Failed to fetch polls', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'matches') {
      fetchMatches();
    } else if (activeTab === 'polls') {
      fetchPolls();
    } else if (activeTab === 'fees') {
      handleGetFees();
    } else if (activeTab === 'contract') {
      handleGetBalance(); // Load balances when contract tab is opened
    } else if (activeTab === 'transactions') {
      fetchTransactions(1);
    } else if (activeTab === 'superadmin') {
      refreshMmBotActor();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-8">
          Super Admin Dashboard
        </h1>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
          <nav className="-mb-px flex space-x-8">
            {['fees', 'matches', 'polls', 'contract', 'transactions', 'superadmin'].map((tab) => (
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
        {activeTab === 'fees' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Fee Management
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Platform Fee (%)
                </label>
                <input
                  type="number"
                  value={feeSettings.platformFee}
                  onChange={(e) => setFeeSettings({ ...feeSettings, platformFee: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                  placeholder="10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Market Platform Fee (%)
                </label>
                <input
                  type="number"
                  value={feeSettings.marketPlatformFee}
                  onChange={(e) => setFeeSettings({ ...feeSettings, marketPlatformFee: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                  placeholder="5"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Free Jackpot Fee (%)
                </label>
                <input
                  type="number"
                  value={feeSettings.freeJackpotFee}
                  onChange={(e) => setFeeSettings({ ...feeSettings, freeJackpotFee: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                  placeholder="5"
                />
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleSetFees}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  Set Fees
                </button>
                <button
                  onClick={handleGetFees}
                  className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600"
                >
                  Get Current Fees
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'matches' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Matches Data
            </h2>
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Match</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Cup</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Free Jackpot</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Boost Jackpot</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Platform Fees</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {matches.slice((tablePage - 1) * ITEMS_PER_PAGE, tablePage * ITEMS_PER_PAGE).map((match) => (
                      <tr key={match._id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                          {match.teamA} vs {match.teamB}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                          {match.cup?.name || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            match.isResolved ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                            'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                          }`}>
                            {match.isResolved ? 'Resolved' : match.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {((match.isResolved && match.originalFreeJackpotPool) ? match.originalFreeJackpotPool : (match.freeJackpotPool || 0)).toFixed(4)} USDC
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {((match.isResolved && match.originalBoostJackpotPool) ? match.originalBoostJackpotPool : (match.boostJackpotPool || 0)).toFixed(4)} USDC
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {(match.platformFees || 0).toFixed(4)} USDC
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {matches.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No matches found
                  </div>
                )}
                {matches.length > ITEMS_PER_PAGE && (
                  <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                      disabled={tablePage <= 1}
                      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Page {tablePage} of {Math.max(1, Math.ceil(matches.length / ITEMS_PER_PAGE))} ({matches.length} total)
                    </span>
                    <button
                      onClick={() => setTablePage((p) => Math.min(Math.ceil(matches.length / ITEMS_PER_PAGE), p + 1))}
                      disabled={tablePage >= Math.ceil(matches.length / ITEMS_PER_PAGE)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'polls' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
              Polls Data
            </h2>
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Question</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Cup</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Free Jackpot</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Boost Jackpot</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Platform Fees</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {polls.slice((tablePage - 1) * ITEMS_PER_PAGE, tablePage * ITEMS_PER_PAGE).map((poll) => (
                      <tr key={poll._id}>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                          {poll.question}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                          {poll.cup?.name || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            poll.isResolved ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' :
                            'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                          }`}>
                            {poll.isResolved ? 'Resolved' : poll.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {((poll.isResolved && poll.originalFreeJackpotPool) ? poll.originalFreeJackpotPool : (poll.freeJackpotPool || 0)).toFixed(4)} USDC
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {((poll.isResolved && poll.originalBoostJackpotPool) ? poll.originalBoostJackpotPool : (poll.boostJackpotPool || 0)).toFixed(4)} USDC
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {(poll.platformFees || 0).toFixed(4)} USDC
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {polls.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No polls found
                  </div>
                )}
                {polls.length > ITEMS_PER_PAGE && (
                  <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                      disabled={tablePage <= 1}
                      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Page {tablePage} of {Math.max(1, Math.ceil(polls.length / ITEMS_PER_PAGE))} ({polls.length} total)
                    </span>
                    <button
                      onClick={() => setTablePage((p) => Math.min(Math.ceil(polls.length / ITEMS_PER_PAGE), p + 1))}
                      disabled={tablePage >= Math.ceil(polls.length / ITEMS_PER_PAGE)}
                      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'contract' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-6">
            {/* Wallet Connection Status */}
            {!account && (
              <div className="bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4 mb-4">
                <p className="text-yellow-800 dark:text-yellow-200 mb-2">
                  Please connect your wallet to interact with the contract
                </p>
                <button
                  onClick={connect}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  Connect Wallet
                </button>
              </div>
            )}
            
            {account && (
              <div className="bg-green-50 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded-lg p-4 mb-4">
                <p className="text-green-800 dark:text-green-200">
                  Connected: {account.slice(0, 6)}...{account.slice(-4)}
                </p>
                {!isBaseSepolia && account && (
                  <p className="text-yellow-800 dark:text-yellow-200 mt-2">
                    ⚠️ You're on a different network. Click any button below to open your wallet and switch to Base automatically.
                  </p>
                )}
              </div>
            )}

            <div className="border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 rounded-lg p-4 space-y-3">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Claim authorization signer
              </h2>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Jackpot and prediction claims need the contract&apos;s claim signer to match the address
                derived from <code className="text-xs">CLAIM_AUTH_PRIVATE_KEY</code> on the API. If it is
                unset (<code className="text-xs">0x0</code>), transactions revert with &quot;Claim signer not set&quot;.
              </p>
              <div className="text-sm space-y-1 text-gray-800 dark:text-gray-200">
                <p>
                  <span className="font-medium">On-chain: </span>
                  {claimSignerOnChain ||
                    (activeTab === 'contract' ? 'Loading…' : 'Open this tab to load')}
                </p>
                <p>
                  <span className="font-medium">From API: </span>
                  {claimSignerFromApi || 'Not available — check backend env'}
                </p>
              </div>
              {!claimSignerFromApi.toLowerCase?.() ||
              !claimSignerOnChain.toLowerCase?.() ||
              claimSignerOnChain.toLowerCase() === ZERO ||
              claimSignerOnChain.toLowerCase() !== claimSignerFromApi.toLowerCase() ? (
                <p className="text-sm text-amber-900 dark:text-amber-200">
                  Connect the <strong>deployer</strong> wallet and press the button so <code className="text-xs">setClaimAuthSigner</code> uses the API address.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={refreshClaimSignerStatus}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                >
                  Refresh signer status
                </button>
                <button
                  type="button"
                  onClick={handleSetClaimAuthSignerOnChain}
                  disabled={!account || !claimSignerFromApi}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Set on-chain signer to API address
                </button>
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-600 rounded-lg p-4 space-y-3">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Platform treasury (USDC vault)
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                All markets share this contract USDC balance. Orderbook trading, boosts, and claims draw from it.
                Use the claim pool section below to fund winner payouts. Connect the <strong>super admin</strong> or{' '}
                <strong>deployer</strong> wallet to fund or withdraw.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-lg text-gray-700 dark:text-gray-300">
                  Total USDC in contract: <strong>{contractBalance || 'N/A'}</strong>
                </p>
                {treasuryUnallocated !== '' && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Surplus above pools &amp; vault liabilities: {treasuryUnallocated} USDC
                  </p>
                )}
                {treasuryVaultLiabilities !== '' && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    User trading vault liabilities (on-chain): {treasuryVaultLiabilities} USDC
                  </p>
                )}
                {treasuryMaxRoutineTransfer !== '' && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Max routine transfer (transferFunds): {treasuryMaxRoutineTransfer} USDC
                  </p>
                )}
                <button
                  onClick={handleGetBalance}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  Refresh treasury
                </button>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                Jackpot Pool Balance
              </h2>
              <div className="flex items-center space-x-4">
                <p className="text-lg text-gray-700 dark:text-gray-300">
                  Pool Balance: {jackpotPoolBalance || 'N/A'} USDC
                </p>
                <button
                  onClick={handleGetBalance}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                Transfer Funds (routine surplus)
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Moves surplus USDC only — cannot drain claim pool, jackpot pool, or user vault backing.
                Deployer and superAdmin can call this on-chain. For a full upgrade drain, use the section below.
              </p>
              <div className="space-y-4">
                <input
                  type="text"
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  placeholder="Recipient Address"
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <input
                  type="number"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="Amount (USDC)"
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <button
                  onClick={handleTransfer}
                  disabled={!account}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Transfer
                </button>
              </div>
            </div>

            <div className="border border-rose-200 dark:border-rose-900/60 rounded-lg p-4 space-y-4 bg-rose-50/50 dark:bg-rose-950/20">
              <h2 className="text-2xl font-bold text-rose-900 dark:text-rose-200">
                Migrate all funds (contract upgrade)
              </h2>
              <p className="text-sm text-rose-900/90 dark:text-rose-100/90">
                Withdraws <strong>100% of USDC</strong> to your wallet when replacing this contract.
                Resets claim pool, jackpot pool, and vault liability counters on-chain. Pause the platform first;
                redeploy a new WeRgame, update <code className="text-xs">CONTRACT_ADDRESS</code>, then migrate users.
              </p>
              <input
                type="text"
                value={migrationTo}
                onChange={(e) => setMigrationTo(e.target.value)}
                placeholder="Recipient address (e.g. deployer multisig)"
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              />
              <button
                type="button"
                onClick={handleMigrateAllFunds}
                disabled={!account || migrationLoading}
                className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {migrationLoading ? 'Migrating…' : 'Migrate all USDC for upgrade'}
              </button>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                Jackpot Pool Management
              </h2>
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Fund Jackpot Pool
                  </h3>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      value={jackpotFundAmount}
                      onChange={(e) => setJackpotFundAmount(e.target.value)}
                      placeholder="Amount (USDC)"
                      className="flex-1 px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      onClick={handleFundJackpotPool}
                      disabled={!account}
                      className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Fund Pool
                    </button>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Withdraw from Jackpot Pool
                  </h3>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={jackpotWithdrawTo}
                      onChange={(e) => setJackpotWithdrawTo(e.target.value)}
                      placeholder="Recipient Address"
                      className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                    />
                    <div className="flex space-x-2">
                      <input
                        type="number"
                        value={jackpotWithdrawAmount}
                        onChange={(e) => setJackpotWithdrawAmount(e.target.value)}
                        placeholder="Amount (USDC)"
                        className="flex-1 px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                      />
                      <button
                        onClick={handleWithdrawFromJackpotPool}
                        disabled={!account}
                        className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Withdraw
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                Claim Prediction Wins Pool
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                This pool pays orderbook and boost/market claim winnings after resolution. Fund it so users can claim.
                On resolve, remaining per-market trading vault collateral is swept here automatically (requires an updated
                contract with <code className="text-xs">finalizeResolvedMarketSettlements</code>).
              </p>
              <div className="flex items-center space-x-4 mb-4">
                <p className="text-lg text-gray-700 dark:text-gray-300">
                  Pool Balance: {claimPredictionWinsPoolBalance !== '' ? `${claimPredictionWinsPoolBalance} USDC` : 'N/A'}
                </p>
                <button
                  onClick={handleGetBalance}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  Refresh
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Fund Claim Prediction Wins Pool
                  </h3>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      value={claimPoolFundAmount}
                      onChange={(e) => setClaimPoolFundAmount(e.target.value)}
                      placeholder="Amount (USDC)"
                      className="flex-1 px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                    />
                    <button
                      onClick={handleFundClaimPredictionWinsPool}
                      disabled={!account}
                      className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Fund Pool
                    </button>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Withdraw from Claim Prediction Wins Pool
                  </h3>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={claimPoolWithdrawTo}
                      onChange={(e) => setClaimPoolWithdrawTo(e.target.value)}
                      placeholder="Recipient Address"
                      className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                    />
                    <div className="flex space-x-2">
                      <input
                        type="number"
                        value={claimPoolWithdrawAmount}
                        onChange={(e) => setClaimPoolWithdrawAmount(e.target.value)}
                        placeholder="Amount (USDC)"
                        className="flex-1 px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                      />
                      <button
                        onClick={handleWithdrawFromClaimPredictionWinsPool}
                        disabled={!account}
                        className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Withdraw
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'transactions' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                Transaction History
              </h2>
              <button
                type="button"
                onClick={() => fetchTransactions(txPage)}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Refresh
              </button>
            </div>
            {txLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Time</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Action</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">USDC</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">USD</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">TX</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {txRows.map((row) => {
                      const eth = row.ethAmount;
                      const usd =
                        row.usdAmount != null
                          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(row.usdAmount))
                          : (eth != null ? formatUsdAmount(eth, { maximumFractionDigits: 2 }) : null);
                      return (
                        <tr key={row._id}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-300">
                            {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                            {row.action}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {eth != null ? `${Number(eth).toFixed(4)} USDC` : '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {usd || '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 dark:text-blue-400">
                            {row.txHash ? (
                              <a
                                href={getBlockExplorerTxUrl(row.txHash)}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="hover:underline"
                                title={String(row.txHash)}
                              >
                                {`${String(row.txHash).slice(0, 10)}...`}
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {txRows.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No transactions logged yet.
                  </div>
                )}
                {txTotal > ITEMS_PER_PAGE && (
                  <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => {
                        const next = Math.max(1, txPage - 1);
                        fetchTransactions(next);
                      }}
                      disabled={txPage <= 1}
                      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Page {txPage} of {txTotalPages} ({txTotal} total)
                    </span>
                    <button
                      onClick={() => {
                        const next = Math.min(txTotalPages, txPage + 1);
                        fetchTransactions(next);
                      }}
                      disabled={txPage >= txTotalPages}
                      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'superadmin' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <div className="space-y-8">
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-5">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Market maker bot wallet
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Set the wallet address used by the platform-controlled market maker bot. You can update it any time.
                  The backend will attach it to an internal <code className="text-xs">market-maker-bot</code> user.
                </p>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={mmBotWallet}
                    onChange={(e) => setMmBotWallet(e.target.value)}
                    placeholder="0x..."
                    className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={refreshMmBotActor}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      onClick={saveMmBotActor}
                      disabled={mmBotSaving}
                      className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {mmBotSaving ? 'Saving…' : 'Save bot wallet'}
                    </button>
                  </div>
                  {mmBotUserId ? (
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      Internal userId: <code>{mmBotUserId}</code>
                    </div>
                  ) : null}
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                  Set SuperAdmin Address
                </h2>
                <div className="space-y-4">
                  <input
                    type="text"
                    value={superAdminAddress}
                    onChange={(e) => setSuperAdminAddress(e.target.value)}
                    placeholder="SuperAdmin Address"
                    className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                  <button
                    onClick={handleSetSuperAdmin}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    Set SuperAdmin
                  </button>
                </div>
              </div>

              <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                  Manage On-chain Admins
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  These admins can use the Admin dashboard to run contract actions (create/resolve markets, add liquidity, update status).
                  This syncs with the smart contract <code className="text-xs">setAdmin(address,bool)</code>.
                  The user who logs in must <strong>link this wallet</strong> to their account; they will then see Admin in the nav dropdown.
                </p>

                <div className="space-y-4">
                  <input
                    type="text"
                    value={adminToSet}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAdminToSet(v);
                      // optimistic refresh on blur; keep it explicit with button too
                    }}
                    onBlur={() => refreshAdminStatus(adminToSet)}
                    placeholder="Admin wallet address (0x...)"
                    className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                  />

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={adminEnabled}
                        onChange={(e) => setAdminEnabled(e.target.checked)}
                      />
                      Enable admin
                    </label>

                    <button
                      type="button"
                      onClick={() => refreshAdminStatus(adminToSet)}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                      Check status
                    </button>

                    <button
                      type="button"
                      onClick={handleSetAdmin}
                      disabled={adminUpdating}
                      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {adminUpdating ? 'Updating…' : 'Update admin on-chain'}
                    </button>
                  </div>

                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    Status:{' '}
                    {adminStatus === null ? (
                      <span className="text-gray-500 dark:text-gray-400">Enter an address to check</span>
                    ) : adminStatus ? (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-300">Enabled</span>
                    ) : (
                      <span className="font-semibold text-red-700 dark:text-red-300">Disabled</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal for notifications */}
        {showModal && (
          <Modal
            isOpen={showModal}
            onClose={() => setShowModal(false)}
            title={modalContent.title}
          >
            <div className="p-4">
              <p className={`mb-4 ${
                modalContent.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'
              }`}>
                {modalContent.message}
              </p>
              <button
                onClick={() => setShowModal(false)}
                className={`w-full px-4 py-2 rounded-lg ${
                  modalContent.type === 'error'
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-blue-500 hover:bg-blue-600'
                } text-white transition-colors`}
              >
                OK
              </button>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
};

export default SuperAdmin;
