import api from './api';
import { setContractAddress, setUsdcAddress, getContractAddress, getUsdcAddress } from './blockchain';

/**
 * Align frontend contract/USDC with backend .env (required after redeploy).
 * @returns {Promise<{ contractAddress: string|null, usdcAddress: string|null, chainId: number }>}
 */
export async function syncChainConfigFromServer() {
  const { data } = await api.get('/config/blockchain');
  const contractAddress = data?.contractAddress || null;
  const usdcAddress = data?.usdcAddress || null;

  if (contractAddress) setContractAddress(contractAddress);
  if (usdcAddress) setUsdcAddress(usdcAddress);

  const envContract = process.env.REACT_APP_CONTRACT_ADDRESS;
  const envUsdc = process.env.REACT_APP_USDC_ADDRESS;
  if (
    envContract &&
    contractAddress &&
    String(envContract).toLowerCase() !== String(contractAddress).toLowerCase()
  ) {
    console.warn(
      '[WeRgame] REACT_APP_CONTRACT_ADDRESS differs from backend. Using backend:',
      contractAddress
    );
  }
  if (envUsdc && usdcAddress && String(envUsdc).toLowerCase() !== String(usdcAddress).toLowerCase()) {
    console.warn('[WeRgame] REACT_APP_USDC_ADDRESS differs from backend. Using backend:', usdcAddress);
  }

  return {
    contractAddress: getContractAddress(),
    usdcAddress: getUsdcAddress(),
    chainId: data?.chainId,
  };
}
