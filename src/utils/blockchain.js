import { ethers } from 'ethers';
import WeRgame from "../abi/WeRgame.json";

// Base Sepolia Testnet configuration
export const BASE_TESTNET_PARAMS = {
  chainId: '0x14a34', // 84532 in hex
  chainName: "Base Sepolia Testnet",
  nativeCurrency: {
    name: "ETH",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: ["https://sepolia.base.org"],
  blockExplorerUrls: ["https://sepolia-explorer.base.org"],
};

// Contract ABI (will be generated from compilation)
export const WERGAME_ABI = WeRgame.abi;

// Contract address (will be set after deployment)
let CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS || '0x148cCBaf340adE10Cc0e57dD43Ab127D5Abfc728';

export const setContractAddress = (address) => {
  CONTRACT_ADDRESS = address;
};

export const getContractAddress = () => CONTRACT_ADDRESS;

/**
 * Check if wallet is connected
 */
export const isWalletConnected = async () => {
  if (typeof window.ethereum !== 'undefined') {
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    return accounts.length > 0;
  }
  return false;
};

/**
 * Connect wallet and switch to Base Sepolia
 */
export const connectWallet = async () => {
  if (typeof window.ethereum === 'undefined') {
    throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
  }

  try {
    // Request account access
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    
    // Check current chain
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    
    // Switch to Base Sepolia if not already on it
    if (chainId !== BASE_TESTNET_PARAMS.chainId) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BASE_TESTNET_PARAMS.chainId }],
        });
      } catch (switchError) {
        // If chain doesn't exist, add it
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [BASE_TESTNET_PARAMS],
          });
        } else {
          throw switchError;
        }
      }
    }
    
    return accounts[0];
  } catch (error) {
    console.error('Error connecting wallet:', error);
    throw error;
  }
};

/**
 * Get current account
 */
export const getCurrentAccount = async () => {
  if (typeof window.ethereum === 'undefined') {
    return null;
  }
  
  const accounts = await window.ethereum.request({ method: 'eth_accounts' });
  return accounts.length > 0 ? accounts[0] : null;
};

/**
 * Ensure wallet is connected before proceeding with transaction
 * This allows any wallet to be connected for transaction signing purposes
 * (doesn't restrict based on registered wallet address)
 */
export const ensureWalletConnected = async () => {
  if (typeof window.ethereum === 'undefined') {
    throw new Error('MetaMask is not installed. Please install MetaMask to continue.');
  }

  // Check if wallet is already connected
  const connected = await isWalletConnected();
  
  if (!connected) {
    // Auto-connect wallet if not connected
    await connectWallet();
  } else {
    // Ensure we're on the correct network
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    if (chainId !== BASE_TESTNET_PARAMS.chainId) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BASE_TESTNET_PARAMS.chainId }],
        });
      } catch (switchError) {
        // If chain doesn't exist, add it
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [BASE_TESTNET_PARAMS],
          });
        } else {
          throw switchError;
        }
      }
    }
  }

  // Return the connected address
  return await getCurrentAccount();
};

/**
 * Get contract instance
 */
export const getContract = async () => {
  // Ensure wallet is connected first
  await ensureWalletConnected();
  
  if (typeof window.ethereum === 'undefined') {
    throw new Error('MetaMask is not installed');
  }
  
  if (!CONTRACT_ADDRESS) {
    throw new Error('Contract address not set');
  }
  
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return new ethers.Contract(CONTRACT_ADDRESS, WERGAME_ABI, signer);
};

/**
 * Get contract instance with read-only provider
 */
export const getContractReadOnly = () => {
  if (!CONTRACT_ADDRESS) {
    throw new Error('Contract address not set');
  }
  
  const provider = new ethers.JsonRpcProvider(BASE_TESTNET_PARAMS.rpcUrls[0]);
  return new ethers.Contract(CONTRACT_ADDRESS, WERGAME_ABI, provider);
};

/**
 * Convert ETH to Wei
 */
export const ethToWei = (eth) => {
  return ethers.parseEther(String(eth));
};

/**
 * Turn contract/RPC errors into a user-friendly message (avoids "data", "missing revert data", etc.)
 */
export const getBlockchainErrorMessage = (err) => {
  const reason = err?.reason;
  const shortMessage = err?.shortMessage;
  const message = err?.message;
  if (reason && typeof reason === 'string' && reason.length > 0 && reason !== 'data') {
    return reason;
  }
  if (shortMessage && typeof shortMessage === 'string' && shortMessage.length > 0 && shortMessage !== 'data') {
    return shortMessage;
  }
  if (message && typeof message === 'string') {
    if (message === 'data' || message.includes('missing revert data')) {
      return 'Transaction failed. Ensure the market is active, your selection is valid, and try again.';
    }
    return message;
  }
  return 'Transaction failed. Please try again or check your wallet network.';
};

/**
 * Convert Wei to ETH
 */
export const weiToEth = (wei) => {
  return ethers.formatEther(wei);
};

/**
 * Market Management Functions
 */

// Create market
export const createMarket = async (isPoll, options) => {
  const contract = await getContract();
  const tx = await contract.createMarket(isPoll, options);
  const receipt = await tx.wait();
  
  // Find MarketCreated event in receipt
  if (receipt && receipt.logs) {
    const iface = contract.interface;
    const eventFragment = iface.getEvent('MarketCreated');
    const eventTopic = eventFragment.topicHash;
    
    for (const log of receipt.logs) {
      try {
        // Check if this is the MarketCreated event
        if (log.topics && log.topics[0] === eventTopic) {
          // marketId is the first indexed parameter, so it's in topics[1]
          if (log.topics[1]) {
            // Convert from hex string to number using ethers
            const marketId = ethers.getNumber(log.topics[1]);
            const marketIdStr = marketId.toString();
            console.log('Market created with ID:', marketIdStr);
            return marketIdStr;
          }
        }
        
        // Try parsing with interface
        const parsed = iface.parseLog({
          topics: Array.isArray(log.topics) ? log.topics : [],
          data: log.data || '0x'
        });
        if (parsed && parsed.name === 'MarketCreated') {
          const marketId = parsed.args.marketId;
          const marketIdStr = marketId.toString ? marketId.toString() : String(marketId);
          console.log('Market created with ID (parsed):', marketIdStr);
          return marketIdStr;
        }
      } catch (e) {
        // Continue to next log
        continue;
      }
    }
  }
  
  // If event not found, throw error
  throw new Error('Market creation event not found. Transaction hash: ' + receipt.hash);
};

// Update market status
export const updateMarketStatus = async (marketId, status) => {
  const contract = await getContract();
  const tx = await contract.updateMarketStatus(marketId, status);
  await tx.wait();
  return tx.hash;
};

// Add liquidity
export const addLiquidity = async (marketId, option, amountEth) => {
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.addLiquidity(marketId, option, amountWei, { value: amountWei });
  await tx.wait();
  return tx.hash;
};

// Resolve market
export const resolveMarket = async (marketId, winningOption) => {
  const contract = await getContract();
  const tx = await contract.resolveMarket(marketId, winningOption);
  await tx.wait();
  return tx.hash;
};

/**
 * Fee Management Functions
 */

// Set fees
export const setFees = async (platformFee, boostJackpotFee, marketPlatformFee, freeJackpotFee) => {
  const contract = await getContract();
  // Convert percentages to basis points (multiply by 100)
  const platformFeeBP = Math.round(platformFee * 100);
  const boostJackpotFeeBP = Math.round(boostJackpotFee * 100);
  const marketPlatformFeeBP = Math.round(marketPlatformFee * 100);
  const freeJackpotFeeBP = Math.round(freeJackpotFee * 100);
  
  const tx = await contract.setFees(platformFeeBP, boostJackpotFeeBP, marketPlatformFeeBP, freeJackpotFeeBP);
  await tx.wait();
  return tx.hash;
};

// Get fees
export const getFees = async () => {
  const contract = getContractReadOnly();
  const fees = await contract.getFees();
  return {
    platformFee: parseFloat(fees[0].toString()) / 100, // Convert from basis points to percentage
    boostJackpotFee: parseFloat(fees[1].toString()) / 100,
    marketPlatformFee: parseFloat(fees[2].toString()) / 100,
    freeJackpotFee: parseFloat(fees[3].toString()) / 100,
  };
};

/**
 * Boost Prediction Functions
 */

// Get market options from contract (read-only, for validation before staking)
export const getMarketOptions = async (marketId) => {
  const contract = getContractReadOnly();
  const options = await contract.getMarketOptions(marketId);
  return Array.isArray(options) ? options.map((o) => (typeof o === 'string' ? o : String(o || '').trim())) : [];
};

// Stake boost
export const stakeBoost = async (marketId, outcome, amountEth) => {
  const contract = await getContract();
  const amountWei = ethToWei(String(amountEth));
  const tx = await contract.stakeBoost(marketId, outcome, { value: amountWei });
  await tx.wait();
  return tx.hash;
};

// Add boost stake
export const addBoostStake = async (marketId, outcome, amountEth) => {
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.addBoostStake(marketId, outcome, { value: amountWei });
  await tx.wait();
  return tx.hash;
};

// Withdraw boost stake
export const withdrawBoostStake = async (marketId, outcome, amountEth) => {
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.withdrawBoostStake(marketId, outcome, amountWei);
  await tx.wait();
  return tx.hash;
};

// Claim boost
export const claimBoost = async (marketId, outcome) => {
  const contract = await getContract();
  const tx = await contract.claimBoost(marketId, outcome);
  await tx.wait();
  return tx.hash;
};

// Get boost prediction
export const getBoostPrediction = async (marketId, userAddress, outcome) => {
  const contract = getContractReadOnly();
  const result = await contract.getBoostPrediction(marketId, userAddress, outcome);
  return {
    user: result[0],
    totalStake: weiToEth(result[1]),
    claimed: result[2],
  };
};

/**
 * Market Trading Functions
 */

// Buy market shares
export const buyMarketShares = async (marketId, outcome, amountEth) => {
  const contract = await getContract();
  const amountWei = ethToWei(String(amountEth));
  const tx = await contract.buyMarketShares(marketId, outcome, { value: amountWei });
  const receipt = await tx.wait();
  return receipt.hash;
};

// Sell market shares
export const sellMarketShares = async (marketId, outcome, shares) => {
  const contract = await getContract();
  // Shares are stored as wei in contract (1 share = 1e18 wei for precision)
  // Convert shares (as decimal ETH amount) to wei
  const sharesWei = ethToWei(shares.toString());
  const tx = await contract.sellMarketShares(marketId, outcome, sharesWei);
  const receipt = await tx.wait();
  return receipt.hash;
};

// Claim market
export const claimMarket = async (marketId, outcome) => {
  const contract = await getContract();
  const tx = await contract.claimMarket(marketId, outcome);
  await tx.wait();
  return tx.hash;
};

/**
 * Claim prediction wins (Boost or Market) from the pool.
 * @param marketId Market id
 * @param isBoost true to claim boost winnings, false to claim market winnings
 */
export const claimPredictionWins = async (marketId, isBoost) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const tx = await contract.claimPredictionWins(marketId, isBoost);
  await tx.wait();
  return tx.hash;
};

// Get claim prediction wins pool balance
export const getClaimPredictionWinsPoolBalance = async () => {
  const contract = getContractReadOnly();
  const balance = await contract.claimPredictionWinsPool();
  return weiToEth(balance);
};

// Fund claim prediction wins pool (deployer only)
export const fundClaimPredictionWinsPool = async (amountEth) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.fundClaimPredictionWinsPool({ value: amountWei });
  await tx.wait();
  return tx.hash;
};

// Withdraw from claim prediction wins pool (deployer only)
export const withdrawFromClaimPredictionWinsPool = async (toAddress, amountEth) => {
  await ensureWalletConnected();
  if (!toAddress || typeof toAddress !== 'string' || !toAddress.trim()) {
    throw new Error('Invalid recipient address');
  }
  const addr = toAddress.trim();
  if (!ethers.isAddress(addr)) {
    throw new Error('Recipient is not a valid Ethereum address');
  }
  const contract = await getContract();
  const amountWei = ethToWei(String(amountEth));
  if (amountWei === 0n) {
    throw new Error('Amount must be greater than 0');
  }
  const tx = await contract.withdrawFromClaimPredictionWinsPool(addr, amountWei);
  await tx.wait();
  return tx.hash;
};

// Get price
export const getPrice = async (marketId, outcome) => {
  const contract = getContractReadOnly();
  const priceBP = await contract.getPrice(marketId, outcome);
  // Price is in basis points (10000 = 100%), convert to decimal
  return parseFloat(priceBP.toString()) / 10000;
};

// Get user position
export const getUserPosition = async (marketId, userAddress, outcome) => {
  const contract = getContractReadOnly();
  const result = await contract.getUserPosition(marketId, userAddress, outcome);
  return {
    shares: weiToEth(result[0]),
    totalInvested: weiToEth(result[1]),
  };
};

/**
 * Jackpot Functions
 */

// Fund jackpot pool
export const fundJackpotPool = async (amountEth) => {
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.fundJackpotPool({ value: amountWei });
  await tx.wait();
  return tx.hash;
};

// Withdraw jackpot
export const withdrawJackpot = async (amountEth) => {
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.withdrawJackpot(amountWei);
  await tx.wait();
  return tx.hash;
};

// Get jackpot balance
export const getJackpotBalance = async (userAddress) => {
  const contract = getContractReadOnly();
  const balance = await contract.getJackpotBalance(userAddress);
  return weiToEth(balance);
};

// Withdraw from jackpot pool (deployer only)
export const withdrawFromJackpotPool = async (toAddress, amountEth) => {
  await ensureWalletConnected();
  if (!toAddress || typeof toAddress !== 'string' || !toAddress.trim()) {
    throw new Error('Invalid recipient address');
  }
  const addr = toAddress.trim();
  if (!ethers.isAddress(addr)) {
    throw new Error('Recipient is not a valid Ethereum address');
  }
  const contract = await getContract();
  const amountWei = ethToWei(String(amountEth));
  if (amountWei === 0n) {
    throw new Error('Amount must be greater than 0');
  }
  const tx = await contract.withdrawFromJackpotPool(addr, amountWei);
  await tx.wait();
  return tx.hash;
};

/**
 * Admin Functions
 */

// Get contract balance
export const getContractBalance = async () => {
  const contract = getContractReadOnly();
  const balance = await contract.getContractBalance();
  return weiToEth(balance);
};

// Transfer funds
export const transferFunds = async (toAddress, amountEth) => {
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.transferFunds(toAddress, amountWei);
  await tx.wait();
  return tx.hash;
};

// Set super admin
export const setSuperAdmin = async (superAdminAddress) => {
  const contract = await getContract();
  const tx = await contract.setSuperAdmin(superAdminAddress);
  await tx.wait();
  return tx.hash;
};

// Get claimable balance
export const getClaimableBalance = async (marketId, userAddress) => {
  const contract = getContractReadOnly();
  const balance = await contract.getClaimableBalance(marketId, userAddress);
  return weiToEth(balance);
};

// Set claimable balance for a user (admin only, legacy)
export const setClaimableBalance = async (marketId, userAddress, amountEth) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.setClaimableBalance(marketId, userAddress, amountWei);
  await tx.wait();
  return tx.hash;
};

// Set claimable boost for a user (admin only)
export const setClaimableBoost = async (marketId, userAddress, amountEth) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.setClaimableBoost(marketId, userAddress, amountWei);
  await tx.wait();
  return tx.hash;
};

// Set claimable market for a user (admin only)
export const setClaimableMarket = async (marketId, userAddress, amountEth) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.setClaimableMarket(marketId, userAddress, amountWei);
  await tx.wait();
  return tx.hash;
};

// Get jackpot pool balance
export const getJackpotPoolBalance = async () => {
  const contract = getContractReadOnly();
  const balance = await contract.jackpotPool();
  return weiToEth(balance);
};

// Set jackpot balance for a user (admin only)
export const setJackpotBalance = async (userAddress, amountEth) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const amountWei = ethToWei(amountEth);
  const tx = await contract.setJackpotBalance(userAddress, amountWei);
  await tx.wait();
  return tx.hash;
};

// Get wallet balance
export const getWalletBalance = async (address) => {
  if (!address) return '0';
  try {
    const provider = new ethers.JsonRpcProvider(BASE_TESTNET_PARAMS.rpcUrls[0]);
    const balance = await provider.getBalance(address);
    return weiToEth(balance);
  } catch (error) {
    console.error('Error getting wallet balance:', error);
    return '0';
  }
};

/**
 * Check if a wallet has enough ETH for a given amount (in ETH).
 * Adds a small buffer so we don't leave the user with zero for gas.
 */
export const hasSufficientEth = async (address, requiredEth, bufferEth = 0.0001) => {
  try {
    if (!address) {
      // If we don't know the address yet, let the normal connect flow handle it
      return true;
    }
    const balanceStr = await getWalletBalance(address);
    const balance = parseFloat(balanceStr || '0');
    const needed = parseFloat(requiredEth || 0) + bufferEth;
    if (Number.isNaN(balance) || Number.isNaN(needed)) {
      return true;
    }
    return balance >= needed;
  } catch (e) {
    console.error('Error checking sufficient ETH:', e);
    // On error, don't block the transaction – let the wallet show the real error
    return true;
  }
};

/**
 * Listen for account changes
 */
export const onAccountsChanged = (callback) => {
  if (typeof window.ethereum !== 'undefined') {
    window.ethereum.on('accountsChanged', callback);
  }
};

/**
 * Listen for chain changes
 */
export const onChainChanged = (callback) => {
  if (typeof window.ethereum !== 'undefined') {
    window.ethereum.on('chainChanged', callback);
  }
};

/**
 * Remove event listeners
 */
export const removeListeners = () => {
  if (typeof window.ethereum !== 'undefined') {
    window.ethereum.removeAllListeners('accountsChanged');
    window.ethereum.removeAllListeners('chainChanged');
  }
};
