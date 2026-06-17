/* eslint-env es2020 */
import { ethers } from 'ethers';
import WeRgame from "../abi/WeRgame.json";
import api from './api';
import {
  BASE_CHAIN_PARAMS,
  BASE_TESTNET_PARAMS,
  DEFAULT_USDC_ADDRESS,
} from './chainParams';

const BASE_CHAIN_NUMERIC_ID = BASE_CHAIN_PARAMS.chainIdDecimal;

/** Read-only HTTP provider with RPC fallbacks. */
function createReadOnlyJsonRpcProvider(urlIndex = 0) {
  const urls = BASE_CHAIN_PARAMS.rpcUrls;
  const url = urls[urlIndex % urls.length];
  return new ethers.JsonRpcProvider(url, BASE_CHAIN_NUMERIC_ID, { staticNetwork: true });
}

async function readUsdcViaBackend(owner, spender) {
  const { data } = await api.get('/config/blockchain/usdc-state', {
    params: { wallet: owner, spender },
    timeout: 12000,
  });
  if (!data?.ok) {
    throw new Error(data?.message || 'Backend USDC read failed');
  }
  return { balance: data.balanceWei, allowance: data.allowanceWei };
}

const USDC_READ_CACHE_MS = 20000;
const usdcReadCache = new Map();
const usdcReadInflight = new Map();
let usdcBackendCooldownUntil = 0;
let loggedUsdcBackendFail = false;
let contractVerifyOkUntil = 0;
const marketOptionsCache = new Map();
const vaultBalanceCache = new Map();
const VAULT_BALANCE_CACHE_MS = 12000;

function usdcCacheKey(owner, spender) {
  return `${String(owner).toLowerCase()}:${String(spender).toLowerCase()}`;
}

function invalidateUsdcReadCache(owner, spender) {
  usdcReadCache.delete(usdcCacheKey(owner, spender));
}

/** Wallet → backend (when healthy) → one public RPC. Deduped + short TTL. */
async function readUsdcBalanceAndAllowanceCached(tokenAddress, owner, spender) {
  const ownerAddr = ethers.getAddress(owner);
  const spenderAddr = ethers.getAddress(spender);
  const tokenAddr = ethers.getAddress(tokenAddress);
  const key = usdcCacheKey(ownerAddr, spenderAddr);
  const hit = usdcReadCache.get(key);
  if (hit && Date.now() - hit.at < USDC_READ_CACHE_MS) {
    return { balance: hit.balance, allowance: hit.allowance };
  }
  if (usdcReadInflight.has(key)) return usdcReadInflight.get(key);

  const work = (async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const usdc = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
        const [balance, allowance] = await Promise.all([
          usdc.balanceOf(ownerAddr),
          usdc.allowance(ownerAddr, spenderAddr),
        ]);
        const val = { balance, allowance, at: Date.now() };
        usdcReadCache.set(key, val);
        return { balance, allowance };
      } catch {
        /* fall through */
      }
    }

    if (Date.now() >= usdcBackendCooldownUntil) {
      try {
        const data = await readUsdcViaBackend(ownerAddr, spenderAddr);
        const val = { balance: data.balance, allowance: data.allowance, at: Date.now() };
        usdcReadCache.set(key, val);
        return { balance: data.balance, allowance: data.allowance };
      } catch (backendErr) {
        usdcBackendCooldownUntil = Date.now() + 120000;
        if (!loggedUsdcBackendFail) {
          loggedUsdcBackendFail = true;
          console.warn('[WeRgame] USDC API read unavailable; using wallet/RPC fallback.');
        }
      }
    }

    const usdc = getUsdcReadContract(tokenAddr);
    const [balance, allowance] = await Promise.all([
      usdc.balanceOf(ownerAddr),
      usdc.allowance(ownerAddr, spenderAddr),
    ]);
    const val = { balance, allowance, at: Date.now() };
    usdcReadCache.set(key, val);
    return { balance, allowance };
  })().finally(() => {
    usdcReadInflight.delete(key);
  });

  usdcReadInflight.set(key, work);
  return work;
}

async function readUsdcBalanceAndAllowance(tokenAddress, owner, spender) {
  const ownerAddr = ethers.getAddress(owner);
  const spenderAddr = ethers.getAddress(spender);

  try {
    return await readUsdcBalanceAndAllowanceCached(tokenAddress, ownerAddr, spenderAddr);
  } catch (firstErr) {
    let lastErr = firstErr;
    for (let i = 1; i < BASE_CHAIN_PARAMS.rpcUrls.length; i++) {
      try {
        const usdc = new ethers.Contract(
          ethers.getAddress(tokenAddress),
          ERC20_ABI,
          createReadOnlyJsonRpcProvider(i)
        );
        const [balance, allowance] = await Promise.all([
          usdc.balanceOf(ownerAddr),
          usdc.allowance(ownerAddr, spenderAddr),
        ]);
        return { balance, allowance };
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(
      `Could not read USDC on ${BASE_CHAIN_PARAMS.chainName}. ` +
        `(${lastErr?.shortMessage || lastErr?.message || lastErr})`
    );
  }
}

/** USDC view calls via public Base RPC. */
function getUsdcReadContract(tokenAddress) {
  const tokenAddr = ethers.getAddress(tokenAddress);
  const provider = createReadOnlyJsonRpcProvider();
  return new ethers.Contract(tokenAddr, ERC20_ABI, provider);
}

export { BASE_CHAIN_PARAMS, BASE_TESTNET_PARAMS } from './chainParams';

async function assertWalletOnBaseChain() {
  if (typeof window.ethereum === 'undefined') return;
  const chainId = await window.ethereum.request({ method: 'eth_chainId' });
  if (chainId !== BASE_CHAIN_PARAMS.chainId) {
    throw new Error(
      `Wrong network in MetaMask (chain ${chainId}). Switch to ${BASE_CHAIN_PARAMS.chainName} (${BASE_CHAIN_PARAMS.chainId} / chain id ${BASE_CHAIN_NUMERIC_ID}).`
    );
  }
}

// Contract ABI (will be generated from compilation)
export const WERGAME_ABI = WeRgame.abi;

// USDC (Base) configuration (token used by the contract)
export const USDC_DECIMALS = Number(process.env.REACT_APP_USDC_DECIMALS || 6);
let USDC_ADDRESS = DEFAULT_USDC_ADDRESS;

export const getUsdcAddress = () => USDC_ADDRESS;
export const setUsdcAddress = (address) => {
  USDC_ADDRESS = address ? String(address).trim() : '';
};
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

// Contract address (will be set after deployment)
let CONTRACT_ADDRESS = process.env.REACT_APP_CONTRACT_ADDRESS || '';

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
 * Connect wallet and switch to Base
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
    
    // Switch to Base if not already on it
    if (chainId !== BASE_CHAIN_PARAMS.chainId) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BASE_CHAIN_PARAMS.chainId }],
        });
      } catch (switchError) {
        // If chain doesn't exist, add it
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [BASE_CHAIN_PARAMS],
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
    if (chainId !== BASE_CHAIN_PARAMS.chainId) {
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BASE_CHAIN_PARAMS.chainId }],
        });
      } catch (switchError) {
        // If chain doesn't exist, add it
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [BASE_CHAIN_PARAMS],
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
  
  const provider = createReadOnlyJsonRpcProvider();
  return new ethers.Contract(CONTRACT_ADDRESS, WERGAME_ABI, provider);
};

export const getUsdcContract = async () => {
  await ensureWalletConnected();
  const usdcAddr = getUsdcAddress();
  if (!usdcAddr || !ethers.isAddress(usdcAddr)) {
    throw new Error('USDC address not set (REACT_APP_USDC_ADDRESS)');
  }
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return new ethers.Contract(usdcAddr, ERC20_ABI, signer);
};

export const getUsdcBalance = async (address) => {
  if (!address) return '0';
  const usdcAddr = getUsdcAddress();
  if (!usdcAddr || !ethers.isAddress(usdcAddr)) {
    throw new Error('USDC address not set (REACT_APP_USDC_ADDRESS)');
  }
  try {
    const owner = ethers.getAddress(address);
    const spender = getContractAddress();
    const { balance } = await readUsdcBalanceAndAllowanceCached(
      usdcAddr,
      owner,
      spender && ethers.isAddress(spender) ? spender : owner
    );
    return unitsToUsdc(balance);
  } catch {
    const usdc = getUsdcReadContract(usdcAddr);
    const bal = await usdc.balanceOf(ethers.getAddress(address));
    return unitsToUsdc(bal);
  }
};

export const transferUsdc = async (toAddress, amountUsdc) => {
  await ensureWalletConnected();
  if (!toAddress || typeof toAddress !== 'string' || !toAddress.trim()) {
    throw new Error('Invalid recipient address');
  }
  const addr = toAddress.trim();
  if (!ethers.isAddress(addr)) {
    throw new Error('Recipient is not a valid address');
  }
  const units = usdcToUnits(amountUsdc);
  if (units <= 0n) {
    throw new Error('Amount must be greater than 0');
  }
  const usdc = await getUsdcContract();
  const tx = await usdc.transfer(addr, units);
  const receipt = await tx.wait();
  return receipt.hash;
};

/** OpenZeppelin v5 EIP-6093 */
const ERC20_INSUFFICIENT_ALLOWANCE_SELECTOR = '0xfb8f41b2';

function toUint256BigInt(v) {
  if (typeof v === 'bigint') return v;
  if (v == null) return 0n;
  try {
    return BigInt(v.toString());
  } catch {
    return 0n;
  }
}

/**
 * Ensure frontend USDC token matches the address baked into WeRgame (avoids approving the wrong token).
 */
export async function assertUsdcMatchesContract() {
  if (!CONTRACT_ADDRESS) {
    throw new Error('Contract address not set (REACT_APP_CONTRACT_ADDRESS)');
  }
  const usdcAddr = getUsdcAddress();
  if (!usdcAddr || !ethers.isAddress(usdcAddr)) {
    throw new Error('USDC address not set (REACT_APP_USDC_ADDRESS)');
  }

  if (Date.now() < contractVerifyOkUntil) return;

  try {
    const { data } = await api.get('/config/blockchain/verify', { timeout: 12000 });
    if (data?.ok && data?.usdcMatch) {
      contractVerifyOkUntil = Date.now() + 300000;
      return;
    }
    if (data && !data.usdcMatch) {
      throw new Error(
        `USDC token mismatch: WeRgame uses ${data.onChainUsdcFromWeRgame} but config has ${data.usdcAddress}. ` +
          'Align backend/frontend .env with deployed-address.txt and restart both servers.'
      );
    }
    if (data && (!data.wergHasCode || !data.usdcHasCode)) {
      throw new Error('WeRgame or USDC has no contract code on chain — wrong network or address.');
    }
  } catch (e) {
    if (e?.response?.status) throw e;
    /* verify via API failed — fall back to one RPC read */
  }

  const c = getContractReadOnly();
  const onChain = await c.usdc();
  const a = ethers.getAddress(onChain);
  const b = ethers.getAddress(usdcAddr);
  if (a !== b) {
    throw new Error(
      `USDC token mismatch: WeRgame contract uses ${a} but REACT_APP_USDC_ADDRESS is ${b}. ` +
        'Update frontend/.env, restart npm start, and confirm USDC_ADDRESS matches the token wired in WeRgame at deploy.'
    );
  }
  contractVerifyOkUntil = Date.now() + 300000;
}

/**
 * Ensure ERC20 allowance for the WeRgame contract to pull `requiredUnits` (USDC base units).
 * Verifies allowance after approve to avoid MetaMask estimateGas failing on addLiquidity while allowance is still 0.
 */
export async function ensureUsdcAllowance(requiredUnits) {
  const req = toUint256BigInt(requiredUnits);
  if (req <= 0n) return;

  await ensureWalletConnected();
  if (typeof window.ethereum === 'undefined') {
    throw new Error('MetaMask is not installed');
  }
  if (!CONTRACT_ADDRESS) {
    throw new Error('Contract address not set');
  }
  const usdcAddr = getUsdcAddress();
  if (!usdcAddr || !ethers.isAddress(usdcAddr)) {
    throw new Error('USDC address not set (REACT_APP_USDC_ADDRESS)');
  }

  await assertUsdcMatchesContract();
  await assertWalletOnBaseChain();

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const owner = ethers.getAddress(await signer.getAddress());
  const spender = ethers.getAddress(CONTRACT_ADDRESS);
  const tokenAddr = ethers.getAddress(usdcAddr);
  const usdcWrite = new ethers.Contract(tokenAddr, ERC20_ABI, signer);

  let { balance, allowance } = await readUsdcBalanceAndAllowance(tokenAddr, owner, spender);
  let balanceBn = toUint256BigInt(balance);
  let allowanceBn = toUint256BigInt(allowance);

  if (balanceBn < req) {
    throw new Error(
      `Insufficient USDC balance. Need at least ${unitsToUsdc(req)} USDC; you have ${unitsToUsdc(balanceBn)}. ` +
        'Fund your wallet with USDC on Base (bridge from Ethereum or buy on an exchange).'
    );
  }

  if (allowanceBn >= req) return;

  // Exact allowance only (no unlimited MaxUint256) so wallets show the real USDC amount.
  const MAX_UINT = ethers.MaxUint256;
  if (allowanceBn > 0n && allowanceBn < MAX_UINT && allowanceBn > req) {
    const resetTx = await usdcWrite.approve(spender, 0);
    const resetRc = await resetTx.wait();
    if (resetRc.status !== 1) {
      throw new Error('USDC approve reset failed');
    }
    allowanceBn = 0n;
  }

  const tx = await usdcWrite.approve(spender, req);
  const receipt = await tx.wait();
  if (receipt.status !== 1) {
    throw new Error('USDC approve transaction failed');
  }

  invalidateUsdcReadCache(owner, spender);

  for (let i = 0; i < 4; i++) {
    ({ allowance } = await readUsdcBalanceAndAllowance(tokenAddr, owner, spender));
    allowanceBn = toUint256BigInt(allowance);
    if (allowanceBn >= req) return;
    await new Promise((r) => setTimeout(r, 400));
  }

  throw new Error(
    'USDC allowance is still too low after approve. Confirm the Approve tx in MetaMask, stay on Base, ' +
      'and ensure REACT_APP_CONTRACT_ADDRESS matches the deployed WeRgame you are calling.'
  );
}

/**
 * Convert ETH to Wei
 */
export const ethToWei = (eth) => {
  return ethers.parseEther(String(eth));
};

/**
 * Convert USDC amount to token units (default 6 decimals).
 */
export const usdcToUnits = (amount) => {
  return ethers.parseUnits(String(amount), USDC_DECIMALS);
};

function extractRevertDataHex(err) {
  const candidates = [
    err?.data,
    err?.error?.data,
    err?.info?.error?.data,
    err?.info?.data,
    err?.body,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('0x') && c.length > 10) return c;
    if (c && typeof c === 'object' && typeof c.data === 'string' && c.data.startsWith('0x')) {
      return c.data;
    }
  }
  const msg = err?.message;
  if (typeof msg === 'string') {
    const m = msg.match(/data="(0x[a-fA-F0-9]+)"/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Turn contract/RPC errors into a user-friendly message (avoids "data", "missing revert data", etc.)
 */
export const getBlockchainErrorMessage = (err) => {
  const hex = extractRevertDataHex(err);
  if (hex && hex.toLowerCase().startsWith(ERC20_INSUFFICIENT_ALLOWANCE_SELECTOR)) {
    return (
      'USDC allowance is too low for the WeRgame contract. Approve USDC when MetaMask prompts, wait for confirmation, ' +
      'then try again. If this persists, restart the dev server and confirm REACT_APP_USDC_ADDRESS matches the token ' +
      'returned by the contract (same as backend USDC_ADDRESS).'
    );
  }
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
    if (message === 'data' || message.includes('missing revert data') || message.includes('CALL_EXCEPTION')) {
      return (
        'On-chain call failed — usually wrong contract/token after a redeploy, or insufficient USDC on Base. ' +
        'Restart frontend and backend, confirm CONTRACT_ADDRESS and USDC_ADDRESS match your mainnet deploy, then try again.'
      );
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
 * Convert USDC token units to human amount.
 */
export const unitsToUsdc = (units) => {
  return ethers.formatUnits(units, USDC_DECIMALS);
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
  const amountUnits = usdcToUnits(amountEth);
  await ensureUsdcAllowance(amountUnits);
  const tx = await contract.addLiquidity(marketId, option, amountUnits);
  await tx.wait();
  return tx.hash;
};

/** Single-tx YES/NO liquidity per outcome (orderbook reference pools). */
export const batchAddOrderbookLiquidity = async (marketId, rows) => {
  const contract = await getContract();
  let total = 0n;
  const formatted = (rows || []).map((r) => {
    const y = usdcToUnits(String(r.yesAmount || 0));
    const n = usdcToUnits(String(r.noAmount || 0));
    total += y + n;
    return { option: r.option, yesAmount: y, noAmount: n };
  });
  if (total > 0n) {
    await ensureUsdcAllowance(total);
  }
  const tx = await contract.batchAddOrderbookLiquidity(marketId, formatted);
  const receipt = await tx.wait();
  return receipt.hash;
};

export const depositTradingVault = async (amountUsdc) => {
  const contract = await getContract();
  const amountUnits = usdcToUnits(String(amountUsdc));
  await ensureUsdcAllowance(amountUnits);
  const tx = await contract.depositTradingVault(amountUnits);
  const receipt = await tx.wait();
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const addr = await signer.getAddress();
    vaultBalanceCache.delete(String(addr).toLowerCase());
  } catch {
    /* ignore */
  }
  return receipt.hash;
};

export const withdrawTradingVaultWithAuth = async (amountWei, nonce, deadline, signature) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const tx = await contract.withdrawTradingVaultWithAuth(
    ethers.getBigInt(amountWei),
    nonce,
    ethers.getBigInt(deadline),
    signature
  );
  const receipt = await tx.wait();
  return receipt.hash;
};

export const getTradingVaultBalance = async (userAddress) => {
  if (!userAddress || !ethers.isAddress(userAddress)) return '0';
  const key = String(userAddress).toLowerCase();
  const hit = vaultBalanceCache.get(key);
  if (hit && Date.now() - hit.at < VAULT_BALANCE_CACHE_MS) return hit.val;

  const contract = getContractReadOnly();
  const bal = await contract.tradingVaultBalances(userAddress);
  const val = unitsToUsdc(bal);
  vaultBalanceCache.set(key, { at: Date.now(), val });
  return val;
};

export const claimOrderbookPositionWithAuth = async (
  marketId,
  amountWei,
  positionKey,
  predictionId,
  deadline,
  signature
) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const tx = await contract.claimOrderbookPositionWithAuth(
    ethers.getBigInt(marketId),
    ethers.getBigInt(amountWei),
    positionKey,
    predictionId,
    ethers.getBigInt(deadline),
    signature
  );
  const receipt = await tx.wait();
  return receipt.hash;
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

// Get market options from contract (read-only, cached)
export const getMarketOptions = async (marketId) => {
  const id = String(marketId);
  const cached = marketOptionsCache.get(id);
  if (cached && Date.now() - cached.at < 300000) return cached.options;

  const contract = getContractReadOnly();
  const options = await contract.getMarketOptions(marketId);
  const normalized = Array.isArray(options)
    ? options.map((o) => (typeof o === 'string' ? o : String(o || '').trim()))
    : [];
  marketOptionsCache.set(id, { at: Date.now(), options: normalized });
  return normalized;
};

/** Stake USDC into boost; funds `claimPredictionWinsPool` on-chain (same pool used by claimPredictionWinsWithAuth). */
export const stakeBoost = async (marketId, outcome, amountEth) => {
  const contract = await getContract();
  const amountUnits = usdcToUnits(String(amountEth));
  await ensureUsdcAllowance(amountUnits);
  const tx = await contract.stakeBoost(marketId, outcome, amountUnits);
  await tx.wait();
  return tx.hash;
};

// Add boost stake
export const addBoostStake = async (marketId, outcome, amountEth) => {
  const contract = await getContract();
  const amountUnits = usdcToUnits(amountEth);
  await ensureUsdcAllowance(amountUnits);
  const tx = await contract.addBoostStake(marketId, outcome, amountUnits);
  await tx.wait();
  return tx.hash;
};

// Withdraw boost stake
export const withdrawBoostStake = async (marketId, outcome, amountEth) => {
  const contract = await getContract();
  const amountUnits = usdcToUnits(amountEth);
  const tx = await contract.withdrawBoostStake(marketId, outcome, amountUnits);
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
    totalStake: unitsToUsdc(result[1]),
    claimed: result[2],
  };
};

/**
 * Market Trading Functions
 */

// Buy market shares
export const buyMarketShares = async (marketId, outcome, amountEth) => {
  const contract = await getContract();
  const amountUnits = usdcToUnits(String(amountEth));
  await ensureUsdcAllowance(amountUnits);
  const tx = await contract.buyMarketShares(marketId, outcome, amountUnits);
  const receipt = await tx.wait();
  return receipt.hash;
};

// Sell market shares
export const sellMarketShares = async (marketId, outcome, shares) => {
  const contract = await getContract();
  // Shares are denominated in USDC units (same precision as USDC_DECIMALS)
  const sharesUnits = usdcToUnits(shares.toString());
  const tx = await contract.sellMarketShares(marketId, outcome, sharesUnits);
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

/**
 * Claim boost/market wins using backend-signed authorization (matches claimPredictionWinsWithAuth on-chain).
 * @param {number|string} marketId
 * @param {boolean} isBoost
 * @param {bigint|string|number} amountWei - wei as BigInt-compatible
 * @param {string} predictionId bytes32 hex
 * @param {number|string|bigint} deadline unix seconds
 * @param {string} signature hex from POST .../claim-authorization (server EIP-191)
 */
export const claimPredictionWinsWithAuth = async (marketId, isBoost, amountWei, predictionId, deadline, signature) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const tx = await contract.claimPredictionWinsWithAuth(
    ethers.getBigInt(marketId),
    isBoost,
    ethers.getBigInt(amountWei),
    predictionId,
    ethers.getBigInt(deadline),
    signature
  );
  const receipt = await tx.wait();
  return receipt.hash;
};

/**
 * Withdraw jackpot using backend-signed authorization (withdrawJackpotWithAuth).
 */
export const withdrawJackpotWithAuth = async (amountWei, nonce, deadline, signature) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const tx = await contract.withdrawJackpotWithAuth(
    ethers.getBigInt(amountWei),
    nonce,
    ethers.getBigInt(deadline),
    signature
  );
  const receipt = await tx.wait();
  return receipt.hash;
};

// Get claim prediction wins pool balance
export const getClaimPredictionWinsPoolBalance = async () => {
  const contract = getContractReadOnly();
  const balance = await contract.claimPredictionWinsPool();
  return unitsToUsdc(balance);
};

// Fund claim prediction wins pool (super admin or deployer)
export const fundClaimPredictionWinsPool = async (amountEth) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const amountUnits = usdcToUnits(amountEth);
  await ensureUsdcAllowance(amountUnits);
  const tx = await contract.fundClaimPredictionWinsPool(amountUnits);
  await tx.wait();
  return tx.hash;
};

// Withdraw from claim prediction wins pool (super admin or deployer)
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
  const amountUnits = usdcToUnits(String(amountEth));
  if (amountUnits === 0n) {
    throw new Error('Amount must be greater than 0');
  }
  const tx = await contract.withdrawFromClaimPredictionWinsPool(addr, amountUnits);
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
    shares: unitsToUsdc(result[0]),
    totalInvested: unitsToUsdc(result[1]),
  };
};

/**
 * Jackpot Functions
 */

// Fund jackpot pool
export const fundJackpotPool = async (amountEth) => {
  const contract = await getContract();
  const amountUnits = usdcToUnits(amountEth);
  await ensureUsdcAllowance(amountUnits);
  const tx = await contract.fundJackpotPool(amountUnits);
  await tx.wait();
  return tx.hash;
};

// Withdraw jackpot
export const withdrawJackpot = async (amountEth) => {
  const contract = await getContract();
  const amountUnits = usdcToUnits(amountEth);
  const tx = await contract.withdrawJackpot(amountUnits);
  await tx.wait();
  return tx.hash;
};

// Get jackpot balance
export const getJackpotBalance = async (userAddress) => {
  const contract = getContractReadOnly();
  const balance = await contract.getJackpotBalance(userAddress);
  return unitsToUsdc(balance);
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
  const amountUnits = usdcToUnits(String(amountEth));
  if (amountUnits === 0n) {
    throw new Error('Amount must be greater than 0');
  }
  const tx = await contract.withdrawFromJackpotPool(addr, amountUnits);
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
  return unitsToUsdc(balance);
};

/** Total USDC in contract + earmarked claim, jackpot, and vault liabilities. */
export const getTreasurySnapshot = async () => {
  const contract = getContractReadOnly();
  const [usdcBalance, claimPoolBalance, jackpotPoolBalance, tradingVaultLiabilities, maxRoutineTransfer] =
    await contract.getTreasurySnapshot();
  return {
    usdcBalance: unitsToUsdc(usdcBalance),
    claimPoolBalance: unitsToUsdc(claimPoolBalance),
    jackpotPoolBalance: unitsToUsdc(jackpotPoolBalance),
    tradingVaultLiabilities: unitsToUsdc(tradingVaultLiabilities),
    maxRoutineTransfer: unitsToUsdc(maxRoutineTransfer),
  };
};

/** Withdraw all USDC when migrating to a new contract deployment (deployer / superAdmin only). */
export const migrateAllFundsForUpgrade = async (toAddress) => {
  await ensureWalletConnected();
  if (!toAddress || typeof toAddress !== 'string' || !toAddress.trim()) {
    throw new Error('Invalid recipient address');
  }
  const addr = toAddress.trim();
  if (!ethers.isAddress(addr)) {
    throw new Error('Recipient is not a valid Ethereum address');
  }
  const contract = await getContract();
  const tx = await contract.migrateAllFundsForUpgrade(addr);
  await tx.wait();
  return tx.hash;
};

// Transfer funds (surplus only — see getTreasurySnapshot.maxRoutineTransfer)
export const transferFunds = async (toAddress, amountEth) => {
  const contract = await getContract();
  const amountUnits = usdcToUnits(amountEth);
  const tx = await contract.transferFunds(toAddress, amountUnits);
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

/**
 * Deployer-only: set/unset an on-chain admin wallet.
 * Admins can call Admin-page contract functions (resolve/update markets, set claimables, set jackpot balances).
 */
export const setAdmin = async (adminAddress, enabled) => {
  await ensureWalletConnected();
  if (!adminAddress || typeof adminAddress !== 'string' || !adminAddress.trim()) {
    throw new Error('Invalid admin address');
  }
  const addr = adminAddress.trim();
  if (!ethers.isAddress(addr)) {
    throw new Error('Admin is not a valid Ethereum address');
  }
  const contract = await getContract();
  const tx = await contract.setAdmin(addr, !!enabled);
  const receipt = await tx.wait();
  return receipt.hash;
};

/** Read-only: check if a wallet is an on-chain admin. */
export const isOnChainAdmin = async (address) => {
  if (!address || typeof address !== 'string' || !ethers.isAddress(address)) return false;
  try {
    const contract = getContractReadOnly();
    // `admins` mapping is a public getter in the updated contract.
    const ok = await contract.admins(address);
    return !!ok;
  } catch (e) {
    // If ABI/contract isn't updated yet, don't hard-fail.
    return false;
  }
};

/** Read-only: current on-chain claim signer (address(0) means claims will revert). */
export const getClaimAuthSigner = async () => {
  const contract = getContractReadOnly();
  return await contract.claimAuthSigner();
};

/** Deployer: must match CLAIM_AUTH_PRIVATE_KEY-derived address after setting key on the API. */
export const setClaimAuthSigner = async (signerAddress) => {
  await ensureWalletConnected();
  if (!signerAddress || !ethers.isAddress(signerAddress)) {
    throw new Error('Invalid claim auth signer address');
  }
  const contract = await getContract();
  const tx = await contract.setClaimAuthSigner(signerAddress);
  const receipt = await tx.wait();
  return receipt.hash;
};

// Get claimable balance
export const getClaimableBalance = async (marketId, userAddress) => {
  const contract = getContractReadOnly();
  const balance = await contract.getClaimableBalance(marketId, userAddress);
  return unitsToUsdc(balance);
};

// Set claimable balance for a user (admin only, legacy)
export const setClaimableBalance = async (marketId, userAddress, amountEth) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const amountUnits = usdcToUnits(amountEth);
  const tx = await contract.setClaimableBalance(marketId, userAddress, amountUnits);
  await tx.wait();
  return tx.hash;
};

// Set claimable boost for a user (admin only)
export const setClaimableBoost = async (marketId, userAddress, amountEth) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const amountUnits = usdcToUnits(amountEth);
  const tx = await contract.setClaimableBoost(marketId, userAddress, amountUnits);
  await tx.wait();
  return tx.hash;
};

// Set claimable market for a user (admin only)
export const setClaimableMarket = async (marketId, userAddress, amountEth) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const amountUnits = usdcToUnits(amountEth);
  const tx = await contract.setClaimableMarket(marketId, userAddress, amountUnits);
  await tx.wait();
  return tx.hash;
};

// Get jackpot pool balance
export const getJackpotPoolBalance = async () => {
  const contract = getContractReadOnly();
  const balance = await contract.jackpotPool();
  return unitsToUsdc(balance);
};

// Set jackpot balance for a user (admin only)
export const setJackpotBalance = async (userAddress, amountEth) => {
  await ensureWalletConnected();
  const contract = await getContract();
  const amountUnits = usdcToUnits(amountEth);
  const tx = await contract.setJackpotBalance(userAddress, amountUnits);
  await tx.wait();
  return tx.hash;
};

// Get wallet balance
export const getWalletBalance = async (address) => {
  if (!address) return '0';
  try {
    const provider = createReadOnlyJsonRpcProvider();
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
