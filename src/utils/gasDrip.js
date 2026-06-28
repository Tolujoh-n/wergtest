import { ethers } from 'ethers';
import api from './api';
import { BASE_CHAIN_PARAMS } from './chainParams';

const DEFAULT_BUFFER_ETH = 0.0001;
const POLL_MS = 800;
const POLL_ATTEMPTS = 10;

async function readEthBalance(address) {
  if (!address) return 0;
  const urls = BASE_CHAIN_PARAMS.rpcUrls || [];
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const provider = new ethers.JsonRpcProvider(urls[i], BASE_CHAIN_PARAMS.chainIdDecimal, {
        staticNetwork: true,
      });
      // eslint-disable-next-line no-await-in-loop
      const bal = await provider.getBalance(address);
      return parseFloat(ethers.formatEther(bal));
    } catch {
      /* try next RPC */
    }
  }
  return 0;
}

export async function hasSufficientEthForGas(address, requiredEth = 0, bufferEth = DEFAULT_BUFFER_ETH) {
  if (!address) return true;
  const balance = await readEthBalance(address);
  const needed = parseFloat(requiredEth || 0) + bufferEth;
  if (Number.isNaN(balance) || Number.isNaN(needed)) return true;
  return balance >= needed;
}

/**
 * If the linked wallet is low on Base ETH, request a drip from the backend relayer.
 * Requires the user to be logged in (Bearer token on api).
 */
export async function ensureGasOrDrip(walletAddress, { label, showNotification, requiredEth = 0 } = {}) {
  if (!walletAddress) return true;
  try {
    const enoughGasNow = await hasSufficientEthForGas(walletAddress, requiredEth);
    if (enoughGasNow) return true;

    try {
      const { data } = await api.post('/relayer/gasdrip', { walletAddress });
      if (data?.sent) {
        showNotification?.('Gas funded for you — confirm in your wallet when prompted.', 'success');
      } else {
        return true;
      }
    } catch (e) {
      showNotification?.(
        e?.response?.data?.message ||
          `Unable to fund gas${label ? ` for ${label}` : ''}. Please add a little Base ETH or try again.`,
        'error'
      );
      return false;
    }

    for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, POLL_MS));
      // eslint-disable-next-line no-await-in-loop
      const ok = await hasSufficientEthForGas(walletAddress, requiredEth);
      if (ok) return true;
    }

    showNotification?.('Gas was funded but has not arrived yet. Please try again in a moment.', 'warning');
    return false;
  } catch {
    return true;
  }
}
