import { ethers } from 'ethers';
import { BASE_TESTNET_PARAMS } from './blockchain';

const ERC721_ABI = ['function balanceOf(address owner) view returns (uint256)'];
const ERC1155_ABI = ['function balanceOf(address account, uint256 id) view returns (uint256)'];
const ERC20_ABI = ['function balanceOf(address account) view returns (uint256)'];

const ZERO = ethers.toBigInt(0);

function normalizeTokenStandard(cfg) {
  const s = String(cfg?.tokenStandard || cfg?.tokenType || 'auto')
    .toLowerCase()
    .trim();
  if (['erc721', 'nft', '721'].includes(s)) return 'erc721';
  if (['erc1155', '1155', 'ft', 'sft'].includes(s)) return 'erc1155';
  if (['erc20', '20', 'fungible', 'token'].includes(s)) return 'erc20';
  return 'auto';
}

function tokenIdForConfig(cfg) {
  const raw = cfg?.tokenId;
  if (raw === undefined || raw === null || raw === '') return ZERO;
  try {
    return ethers.toBigInt(raw);
  } catch {
    return ZERO;
  }
}

function hasPositiveBalance(bal) {
  return ethers.getBigInt(bal ?? 0) > ZERO;
}

function getReadProvider() {
  if (typeof window !== 'undefined' && window.ethereum) {
    return new ethers.BrowserProvider(window.ethereum);
  }
  const chainId = Number.parseInt(BASE_TESTNET_PARAMS.chainId, 16);
  return new ethers.JsonRpcProvider(BASE_TESTNET_PARAMS.rpcUrls[0], chainId, { staticNetwork: true });
}

async function erc721Balance(provider, contractAddress, owner) {
  const c = new ethers.Contract(contractAddress, ERC721_ABI, provider);
  const bal = await c.balanceOf(owner);
  return hasPositiveBalance(bal);
}

async function erc1155Balance(provider, contractAddress, owner, tokenId) {
  const c = new ethers.Contract(contractAddress, ERC1155_ABI, provider);
  const bal = await c.balanceOf(owner, tokenId);
  return hasPositiveBalance(bal);
}

async function erc20Balance(provider, contractAddress, owner) {
  const c = new ethers.Contract(contractAddress, ERC20_ABI, provider);
  const bal = await c.balanceOf(owner);
  return hasPositiveBalance(bal);
}

export async function ownerHoldsTokenOnChain(contractAddress, ownerAddress, cfg = {}) {
  const addr = String(contractAddress || '').trim();
  if (!addr || !ethers.isAddress(addr) || !ownerAddress || !ethers.isAddress(ownerAddress)) {
    return false;
  }
  const owner = ethers.getAddress(ownerAddress);
  const provider = getReadProvider();
  const standard = normalizeTokenStandard(cfg);
  const tokenId = tokenIdForConfig(cfg);

  if (standard === 'erc721') {
    try {
      return await erc721Balance(provider, addr, owner);
    } catch {
      return false;
    }
  }
  if (standard === 'erc1155') {
    try {
      return await erc1155Balance(provider, addr, owner, tokenId);
    } catch {
      return false;
    }
  }
  if (standard === 'erc20') {
    try {
      return await erc20Balance(provider, addr, owner);
    } catch {
      return false;
    }
  }

  try {
    if (await erc721Balance(provider, addr, owner)) return true;
  } catch {
    /* */
  }
  try {
    if (await erc1155Balance(provider, addr, owner, tokenId)) return true;
    if (tokenId > ZERO && (await erc1155Balance(provider, addr, owner, ZERO))) return true;
  } catch {
    /* */
  }
  try {
    if (await erc20Balance(provider, addr, owner)) return true;
  } catch {
    /* */
  }
  return false;
}

/** Client-side pass over admin-configured rows (for instant UI while server verifies). */
export async function enrichNftBonusesWithClientHolds(nftBonuses, walletAddress) {
  if (!walletAddress || !Array.isArray(nftBonuses) || !nftBonuses.length) return nftBonuses;
  const out = [];
  for (const row of nftBonuses) {
    let clientHolds = null;
    if (row.contractAddress) {
      try {
        clientHolds = await ownerHoldsTokenOnChain(row.contractAddress, walletAddress, row);
      } catch {
        clientHolds = null;
      }
    }
    out.push({ ...row, clientHolds });
  }
  return out;
}
