import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import Modal from '../components/Modal';
import { useNotification } from '../components/Notification';
import { useWallet } from '../context/WalletContext';
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
  fundClaimPredictionWinsPool,
  withdrawFromClaimPredictionWinsPool,
  ensureWalletConnected,
} from '../utils/blockchain';

const ITEMS_PER_PAGE = 20;

const SuperAdmin = () => {
  const [activeTab, setActiveTab] = useState('fees');
  const [feeSettings, setFeeSettings] = useState({
    platformFee: '',
    boostJackpotFee: '',
    marketPlatformFee: '',
    freeJackpotFee: '',
  });
  const [contractBalance, setContractBalance] = useState('');
  const [jackpotPoolBalance, setJackpotPoolBalance] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [superAdminAddress, setSuperAdminAddress] = useState('');
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
  const [tablePage, setTablePage] = useState(1);
  const { showNotification } = useNotification();
  const { account, connect, isBaseSepolia } = useWallet();

  useEffect(() => {
    setTablePage(1);
  }, [activeTab]);
  
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

  const handleSetFees = async () => {
    try {
      // Connect wallet and switch to Base Sepolia if needed (pops wallet)
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base Sepolia in your wallet', 'error');
      return;
    }
    try {
      // First, set fees on blockchain
      const txHash = await setFeesOnChain(
        parseFloat(feeSettings.platformFee || 0),
        parseFloat(feeSettings.boostJackpotFee || 0),
        parseFloat(feeSettings.marketPlatformFee || 0),
        parseFloat(feeSettings.freeJackpotFee || 0)
      );
      showNotification(`Fees set on blockchain! TX: ${txHash.slice(0, 10)}...`, 'success');
      
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
      showNotification(switchErr?.message || 'Please switch to Base Sepolia in your wallet', 'error');
      return;
    }
    try {
      // Transfer on blockchain first
      const txHash = await transferFundsOnChain(transferTo, parseFloat(transferAmount));
      showNotification(`Transfer successful! TX: ${txHash.slice(0, 10)}...`, 'success');
      
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
  
  const handleFundJackpotPool = async () => {
    // Wallet will auto-connect when blockchain function is called
    
    try {
      await ensureWalletConnected();
    } catch (switchErr) {
      showNotification(switchErr?.message || 'Please switch to Base Sepolia in your wallet', 'error');
      return;
    }
    if (!jackpotFundAmount || parseFloat(jackpotFundAmount) <= 0) {
      showNotification('Please enter a valid amount', 'warning');
      return;
    }
    
    try {
      const txHash = await fundJackpotPool(parseFloat(jackpotFundAmount));
      showNotification(`Jackpot pool funded! TX: ${txHash.slice(0, 10)}...`, 'success');
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
      showNotification(switchErr?.message || 'Please switch to Base Sepolia in your wallet', 'error');
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
      showNotification(switchErr?.message || 'Please switch to Base Sepolia in your wallet', 'error');
      return;
    }
    if (!claimPoolFundAmount || parseFloat(claimPoolFundAmount) <= 0) {
      showNotification('Please enter a valid amount', 'warning');
      return;
    }
    try {
      const txHash = await fundClaimPredictionWinsPool(parseFloat(claimPoolFundAmount));
      showNotification(`Claim prediction wins pool funded! TX: ${txHash.slice(0, 10)}...`, 'success');
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
      showNotification(switchErr?.message || 'Please switch to Base Sepolia in your wallet', 'error');
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
      showNotification(switchErr?.message || 'Please switch to Base Sepolia in your wallet', 'error');
      return;
    }
    try {
      // Set on blockchain first
      const txHash = await setSuperAdminOnChain(superAdminAddress);
      showNotification(`SuperAdmin set on blockchain! TX: ${txHash.slice(0, 10)}...`, 'success');
      
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
    }
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
            {['fees', 'matches', 'polls', 'contract', 'superadmin'].map((tab) => (
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
                  Boost Jackpot Fee (%)
                </label>
                <input
                  type="number"
                  value={feeSettings.boostJackpotFee}
                  onChange={(e) => setFeeSettings({ ...feeSettings, boostJackpotFee: e.target.value })}
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
                          {((match.isResolved && match.originalFreeJackpotPool) ? match.originalFreeJackpotPool : (match.freeJackpotPool || 0)).toFixed(4)} ETH
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {((match.isResolved && match.originalBoostJackpotPool) ? match.originalBoostJackpotPool : (match.boostJackpotPool || 0)).toFixed(4)} ETH
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {(match.platformFees || 0).toFixed(4)} ETH
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
                          {((poll.isResolved && poll.originalFreeJackpotPool) ? poll.originalFreeJackpotPool : (poll.freeJackpotPool || 0)).toFixed(4)} ETH
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {((poll.isResolved && poll.originalBoostJackpotPool) ? poll.originalBoostJackpotPool : (poll.boostJackpotPool || 0)).toFixed(4)} ETH
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {(poll.platformFees || 0).toFixed(4)} ETH
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
                    ⚠️ You're on a different network. Click any button below to open your wallet and switch to Base Sepolia automatically.
                  </p>
                )}
              </div>
            )}

            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                Contract Balance
              </h2>
              <div className="flex items-center space-x-4">
                <p className="text-lg text-gray-700 dark:text-gray-300">
                  Balance: {contractBalance || 'N/A'} ETH
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
                Jackpot Pool Balance
              </h2>
              <div className="flex items-center space-x-4">
                <p className="text-lg text-gray-700 dark:text-gray-300">
                  Pool Balance: {jackpotPoolBalance || 'N/A'} ETH
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
                Transfer Funds
              </h2>
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
                  placeholder="Amount (ETH)"
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
                      placeholder="Amount (ETH)"
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
                        placeholder="Amount (ETH)"
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
                This pool pays out Boost and Market prediction winnings. Fund it so users can claim after resolution. Boost stakes and market buys also add to this pool.
              </p>
              <div className="flex items-center space-x-4 mb-4">
                <p className="text-lg text-gray-700 dark:text-gray-300">
                  Pool Balance: {claimPredictionWinsPoolBalance !== '' ? `${claimPredictionWinsPoolBalance} ETH` : 'N/A'}
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
                      placeholder="Amount (ETH)"
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
                        placeholder="Amount (ETH)"
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

        {activeTab === 'superadmin' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
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
