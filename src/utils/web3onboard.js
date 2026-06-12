import init from '@web3-onboard/core';
import injectedModule from '@web3-onboard/injected-wallets';
import walletConnectModule from '@web3-onboard/walletconnect';
import { BASE_CHAIN_PARAMS } from './chainParams';

const injected = injectedModule();
const walletConnect = walletConnectModule({
  projectId: process.env.REACT_APP_WALLETCONNECT_PROJECT_ID || 'ba490b9a5e85784e42a85b08a41c8e22',
});

let onboardInstance = null;

export const initOnboard = () => {
  if (typeof window === 'undefined') return null;
  if (onboardInstance) {
    return onboardInstance;
  }

  onboardInstance = init({
    wallets: [injected, walletConnect],
    chains: [
      {
        id: BASE_CHAIN_PARAMS.chainId,
        token: 'ETH',
        label: BASE_CHAIN_PARAMS.chainName,
        rpcUrl: BASE_CHAIN_PARAMS.rpcUrls[0],
      },
    ],
    appMetadata: {
      name: 'WeRgame',
      description: 'WeRgame prediction platform',
    },
    accountCenter: {
      desktop: {
        enabled: false,
      },
      mobile: {
        enabled: false,
      },
    },
  });

  return onboardInstance;
};
