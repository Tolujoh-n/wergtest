import React, { useEffect, useMemo, useState } from 'react';
import { useWallet } from '../context/WalletContext';
import { useNotification } from '../components/Notification';
import Modal from '../components/Modal';
import api from '../utils/api';
import { formatUsdAmount } from '../utils/money';
import {
  getWalletBalance,
  getUsdcBalance,
  transferUsdc,
  depositTradingVault,
  withdrawTradingVaultWithAuth,
} from '../utils/blockchain';
import { ethers } from 'ethers';
import { useAuth } from '../context/AuthContext';
import { syncChainConfigFromServer } from '../utils/syncChainConfig';
import { getBlockExplorerTxUrl } from '../utils/chainParams';

const ITEMS_PER_PAGE = 20;

export default function WalletPage() {
  const { account, connect, ensureConnected, isBaseSepolia } = useWallet();
  const { user, refreshUser } = useAuth();
  const { showNotification } = useNotification();

  const [ethBalance, setEthBalance] = useState('0');
  const [usdcBalance, setUsdcBalance] = useState('0');

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [token, setToken] = useState('USDC'); // USDC | ETH
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);

  const [txRows, setTxRows] = useState([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txPage, setTxPage] = useState(1);
  const [txTotalPages, setTxTotalPages] = useState(1);

  const [vaultInfo, setVaultInfo] = useState(null);
  const [vaultDepositAmt, setVaultDepositAmt] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);

  const shortAccount = useMemo(() => {
    if (!account) return '';
    return `${account.slice(0, 6)}...${account.slice(-4)}`;
  }, [account]);

  const refreshBalances = async () => {
    if (!account) return;
    try {
      const [eth, usdc] = await Promise.all([
        getWalletBalance(account),
        getUsdcBalance(account),
      ]);
      setEthBalance(eth || '0');
      setUsdcBalance(usdc || '0');
    } catch (e) {
      console.error('refreshBalances:', e);
    }
  };

  const ensureWalletLinked = async () => {
    if (!user || !account) return false;
    try {
      const { data: meData } = await api.get('/auth/me');
      const wallets = Array.isArray(meData?.user?.wallets) ? meData.user.wallets : [];
      const linked = wallets.some((w) => String(w).toLowerCase() === String(account).toLowerCase());
      if (linked) return true;
      const { data: linkData } = await api.post('/auth/wallets/link', { address: account });
      if (linkData?.user) refreshUser(linkData.user);
      else await refreshUser();
      return true;
    } catch (e) {
      showNotification(e.response?.data?.message || 'Link this wallet to your account first', 'warning');
      return false;
    }
  };

  const refreshVault = async () => {
    if (!account) {
      setVaultInfo(null);
      return;
    }
    try {
      if (user) await ensureWalletLinked();
      const { data } = await api.get('/orderbook/vault', { params: { walletAddress: account } });
      setVaultInfo(data);
    } catch (e) {
      setVaultInfo(null);
      if (e?.response?.status === 403) {
        showNotification(
          e.response?.data?.message || 'Link this wallet to your account to view the trading vault.',
          'warning'
        );
      }
    }
  };

  const fetchTransactions = async (page = txPage) => {
    setTxLoading(true);
    try {
      const { data } = await api.get('/transactions/me', {
        params: { page, limit: ITEMS_PER_PAGE },
      });
      setTxRows(data?.rows || []);
      setTxPage(data?.page || page);
      setTxTotalPages(data?.totalPages || 1);
    } catch (e) {
      setTxRows([]);
      setTxTotalPages(1);
    } finally {
      setTxLoading(false);
    }
  };

  useEffect(() => {
    syncChainConfigFromServer().catch(() => {});
  }, []);

  useEffect(() => {
    if (account) {
      refreshBalances();
      refreshVault();
      fetchTransactions(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, user]);

  const handleVaultDeposit = async () => {
    if (!account) {
      showNotification('Please connect your wallet first', 'warning');
      return;
    }
    const amt = parseFloat(String(vaultDepositAmt || '').trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      showNotification('Enter a valid deposit amount', 'warning');
      return;
    }
    setVaultBusy(true);
    try {
      await ensureConnected();
      if (!isBaseSepolia) {
        showNotification('Please switch your wallet to Base', 'warning');
        return;
      }
      await syncChainConfigFromServer();
      if (!(await ensureWalletLinked())) return;
      await depositTradingVault(amt);
      showNotification('Deposited to trading vault', 'success');
      setVaultDepositAmt('');
      await Promise.all([refreshBalances(), refreshVault()]);
    } catch (e) {
      console.error('handleVaultDeposit:', e);
      showNotification(e?.shortMessage || e?.message || 'Deposit failed', 'error');
    } finally {
      setVaultBusy(false);
    }
  };

  const handleVaultWithdrawAll = async () => {
    if (!account) {
      showNotification('Please connect your wallet first', 'warning');
      return;
    }
    setVaultBusy(true);
    try {
      await ensureConnected();
      if (!isBaseSepolia) {
        showNotification('Please switch your wallet to Base', 'warning');
        return;
      }
      const avail = Number(vaultInfo?.availableUsdc ?? 0);
      if (!Number.isFinite(avail) || avail <= 0) {
        showNotification('Nothing withdrawable', 'warning');
        return;
      }
      const { data } = await api.post('/orderbook/vault/withdraw-auth', {
        walletAddress: account,
        amountUsdc: avail,
      });
      await withdrawTradingVaultWithAuth(data.amountWei, data.nonce, data.deadline, data.signature);
      showNotification('Withdrew from trading vault', 'success');
      await Promise.all([refreshBalances(), refreshVault()]);
    } catch (e) {
      console.error('handleVaultWithdrawAll:', e);
      showNotification(e?.response?.data?.message || e?.message || 'Withdraw failed', 'error');
    } finally {
      setVaultBusy(false);
    }
  };

  const handleSend = async () => {
    if (!account) {
      showNotification('Please connect your wallet first', 'warning');
      return;
    }
    const toAddr = String(to || '').trim();
    const amtStr = String(amount || '').trim();
    if (!toAddr || !ethers.isAddress(toAddr)) {
      showNotification('Enter a valid recipient address', 'warning');
      return;
    }
    const amt = parseFloat(amtStr);
    if (!Number.isFinite(amt) || amt <= 0) {
      showNotification('Enter a valid amount', 'warning');
      return;
    }

    setSending(true);
    try {
      await ensureConnected();
      if (!isBaseSepolia) {
        showNotification('Please switch your wallet to Base', 'warning');
        return;
      }

      let txHash = '';
      if (token === 'ETH') {
        if (typeof window.ethereum === 'undefined') {
          showNotification('No wallet provider found', 'error');
          return;
        }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const tx = await signer.sendTransaction({
          to: toAddr,
          value: ethers.parseEther(amtStr),
        });
        txHash = tx.hash;
        await tx.wait();
      } else {
        txHash = await transferUsdc(toAddr, amtStr);
      }

      // Log to backend for Wallet transaction history table
      try {
        await api.post('/transactions', {
          action: token === 'ETH' ? 'wallet_transfer_eth' : 'wallet_transfer_usdc',
          txHash,
          amount: amt,
          currency: token,
          itemType: 'none',
          meta: { to: toAddr },
        });
      } catch {
        // ignore logging errors
      }

      showNotification(`Transfer confirmed! TX: ${String(txHash).slice(0, 10)}...`, 'success');
      setTransferOpen(false);
      setTo('');
      setAmount('');
      await refreshBalances();
      await fetchTransactions(1);
    } catch (e) {
      console.error('handleSend:', e);
      showNotification(e?.shortMessage || e?.message || 'Transfer failed', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Wallet</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              View balances, receive, transfer, and your platform transaction history.
            </p>
          </div>
          {!account ? (
            <button
              type="button"
              onClick={connect}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              Connect Wallet
            </button>
          ) : (
            <div className="text-sm text-gray-700 dark:text-gray-300 font-mono">
              {shortAccount}
            </div>
          )}
        </div>

        {account && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-4">
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={() => setReceiveOpen(true)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                Deposit / Receive
              </button>
              <button
                type="button"
                onClick={() => setTransferOpen(true)}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
              >
                Transfer
              </button>
              <button
                type="button"
                onClick={refreshBalances}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Refresh balances
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-xs text-gray-500 dark:text-gray-400">Base ETH (gas)</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {Number(ethBalance || 0).toFixed(6)} ETH
                </div>
              </div>
              <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-xs text-gray-500 dark:text-gray-400">USDC</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {formatUsdAmount(usdcBalance || 0)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {Number(usdcBalance || 0).toFixed(2)} USDC
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Trading Vault */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Trading vault</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Deposit USDC here to trade on the orderbook. Your vault balance is what the matcher uses for fills.
              </p>
            </div>
            <button
              type="button"
              onClick={refreshVault}
              className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
              disabled={!account}
            >
              Refresh
            </button>
          </div>

          {!account ? (
            <div className="text-sm text-gray-600 dark:text-gray-400">Connect your wallet to manage your trading vault.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Vault (on-chain)</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                    {formatUsdAmount(vaultInfo?.onChainVaultUsdc ?? 0)}
                  </div>
                </div>
                <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Reserved</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                    {formatUsdAmount(vaultInfo?.reservedUsdc ?? 0)}
                  </div>
                </div>
                <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="text-xs text-gray-500 dark:text-gray-400">Withdrawable</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                    {formatUsdAmount(vaultInfo?.availableUsdc ?? 0)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Deposit USDC</label>
                  <input
                    type="number"
                    value={vaultDepositAmt}
                    onChange={(e) => setVaultDepositAmt(e.target.value)}
                    placeholder="e.g. 25"
                    className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
                  />
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Deposits stay in your vault until you withdraw, or they are used to settle filled orders.
                  </div>
                </div>
                <div className="flex flex-col gap-2 justify-end">
                  <button
                    type="button"
                    onClick={handleVaultDeposit}
                    disabled={vaultBusy}
                    className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {vaultBusy ? 'Processing…' : 'Deposit to vault'}
                  </button>
                  <button
                    type="button"
                    onClick={handleVaultWithdrawAll}
                    disabled={vaultBusy}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
                  >
                    {vaultBusy ? 'Processing…' : 'Withdraw all'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Transactions */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Transaction history</h2>
            <button
              type="button"
              onClick={() => fetchTransactions(txPage)}
              className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              disabled={!account}
            >
              Refresh
            </button>
          </div>

          {!account ? (
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Connect your wallet to see your transaction history.
            </div>
          ) : txLoading ? (
            <div className="py-8 text-center text-gray-500 dark:text-gray-400">Loading…</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Time</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Action</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">TX</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {txRows.map((row) => (
                      <tr key={row._id}>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-300">
                          {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                          {row.action}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {row.amount != null
                            ? row.currency === 'ETH'
                              ? `${Number(row.amount).toFixed(6)} ETH`
                              : formatUsdAmount(row.amount)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-600 dark:text-blue-400">
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
                    ))}
                  </tbody>
                </table>
                {txRows.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    No transactions yet.
                  </div>
                )}
              </div>

              {txTotalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(1, txPage - 1);
                      fetchTransactions(next);
                    }}
                    disabled={txPage <= 1}
                    className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    Page {txPage} of {txTotalPages}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.min(txTotalPages, txPage + 1);
                      fetchTransactions(next);
                    }}
                    disabled={txPage >= txTotalPages}
                    className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Receive modal */}
      {receiveOpen && (
        <Modal isOpen={true} onClose={() => setReceiveOpen(false)} title="Deposit / Receive">
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Send <strong>Base ETH</strong> (for gas) or <strong>USDC</strong> to this address:
            </p>
            <div className="p-3 rounded-lg bg-gray-100 dark:bg-gray-700 font-mono text-sm break-all text-gray-900 dark:text-white">
              {account || '—'}
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(account || '');
                  showNotification('Address copied', 'success');
                } catch {
                  showNotification('Could not copy address', 'warning');
                }
              }}
              disabled={!account}
              className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              Copy address
            </button>
          </div>
        </Modal>
      )}

      {/* Transfer modal */}
      {transferOpen && (
        <Modal isOpen={true} onClose={() => setTransferOpen(false)} title="Transfer">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Token</label>
              <select
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              >
                <option value="USDC">USDC</option>
                <option value="ETH">ETH</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To</label>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={token === 'ETH' ? '0.001' : '10'}
                className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:text-white"
              />
              {token === 'USDC' ? (
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {formatUsdAmount(amount || 0)}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

