import init from '@web3-onboard/core';
import injectedModule from '@web3-onboard/injected-wallets';

const injected = injectedModule();

let onboardInstance = null;

export const initOnboard = () => {
  if (onboardInstance) {
    return onboardInstance;
  }

  onboardInstance = init({
    wallets: [injected],
    chains: [
      {
        id: '0x1', // Ethereum Mainnet
        token: 'ETH',
        label: 'Ethereum Mainnet',
        rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/demo',
      },
      {
        id: '0x5', // Goerli Testnet
        token: 'ETH',
        label: 'Goerli Testnet',
        rpcUrl: 'https://eth-goerli.g.alchemy.com/v2/demo',
      },
      {
        id: '0x13881', // Mumbai Testnet
        token: 'MATIC',
        label: 'Mumbai Testnet',
        rpcUrl: 'https://rpc-mumbai.maticvigil.com',
      },
    ],
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
