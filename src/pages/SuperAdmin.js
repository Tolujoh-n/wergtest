import React, { useState } from 'react';
import api from '../utils/api';

const SuperAdmin = () => {
  const [activeTab, setActiveTab] = useState('fees');
  const [feeSettings, setFeeSettings] = useState({
    platformFee: '',
    boostJackpotFee: '',
    marketPlatformFee: '',
    freeJackpotFee: '',
  });
  const [contractBalance, setContractBalance] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [superAdminAddress, setSuperAdminAddress] = useState('');

  const handleSetFees = async () => {
    try {
      await api.post('/superadmin/set-fees', feeSettings);
      alert('Fees updated successfully!');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to set fees');
    }
  };

  const handleGetFees = async () => {
    try {
      const response = await api.get('/superadmin/get-fees');
      setFeeSettings(response.data);
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to get fees');
    }
  };

  const handleGetBalance = async () => {
    try {
      const response = await api.get('/superadmin/contract-balance');
      setContractBalance(response.data.balance);
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to get balance');
    }
  };

  const handleTransfer = async () => {
    try {
      await api.post('/superadmin/transfer', {
        to: transferTo,
        amount: transferAmount,
      });
      alert('Transfer successful!');
      setTransferAmount('');
      setTransferTo('');
    } catch (error) {
      alert(error.response?.data?.message || 'Transfer failed');
    }
  };

  const handleSetSuperAdmin = async () => {
    try {
      await api.post('/superadmin/set-superadmin', {
        address: superAdminAddress,
      });
      alert('SuperAdmin address set successfully!');
      setSuperAdminAddress('');
    } catch (error) {
      alert(error.response?.data?.message || 'Failed to set SuperAdmin');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-8">
          Super Admin Dashboard
        </h1>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
          <nav className="-mb-px flex space-x-8">
            {['fees', 'contract', 'superadmin'].map((tab) => (
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

        {activeTab === 'contract' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-6">
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
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
                >
                  Transfer
                </button>
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
      </div>
    </div>
  );
};

export default SuperAdmin;
