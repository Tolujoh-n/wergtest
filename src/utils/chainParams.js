/** Official USDC on Base mainnet (Circle). */
export const BASE_USDC_MAINNET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

export function chainIdDecimalToHex(decimal) {
  return `0x${Number(decimal).toString(16)}`;
}

const CHAIN_ID_DECIMAL = Number(process.env.REACT_APP_CHAIN_ID || 8453);

const rpcPrimary = process.env.REACT_APP_RPC_URL || 'https://mainnet.base.org';
const rpcFallback = process.env.REACT_APP_RPC_URL_FALLBACK || 'https://base-rpc.publicnode.com';

/** Wallet add/switch params (MetaMask / EIP-3085). */
export const BASE_CHAIN_PARAMS = {
  chainId: chainIdDecimalToHex(CHAIN_ID_DECIMAL),
  chainIdDecimal: CHAIN_ID_DECIMAL,
  chainName: process.env.REACT_APP_CHAIN_NAME || 'Base',
  nativeCurrency: {
    name: 'ETH',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: [rpcPrimary, rpcFallback].filter((url, index, all) => url && all.indexOf(url) === index),
  blockExplorerUrls: [process.env.REACT_APP_BLOCK_EXPLORER || 'https://basescan.org'],
};

/** @deprecated Use BASE_CHAIN_PARAMS — kept for older imports. */
export const BASE_TESTNET_PARAMS = BASE_CHAIN_PARAMS;

export const getBlockExplorerBase = () =>
  String(BASE_CHAIN_PARAMS.blockExplorerUrls[0] || 'https://basescan.org').replace(/\/$/, '');

export const getBlockExplorerTxUrl = (txHash) => {
  const hash = String(txHash || '').trim();
  if (!hash) return getBlockExplorerBase();
  return `${getBlockExplorerBase()}/tx/${hash.startsWith('0x') ? hash : `0x${hash}`}`;
};

export const DEFAULT_USDC_ADDRESS =
  process.env.REACT_APP_USDC_ADDRESS || BASE_USDC_MAINNET;
