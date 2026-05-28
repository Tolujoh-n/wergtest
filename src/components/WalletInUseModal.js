import React from 'react';
import Modal from './Modal';

const WalletInUseModal = ({ isOpen, walletAddress, onDisconnect }) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {}}
      dismissable={false}
      title="Wallet already in use"
      size="md"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 p-4">
          <div className="text-sm text-red-800 dark:text-red-200 font-medium">
            The wallet address is already associated with another account.
          </div>
          {walletAddress ? (
            <div className="mt-2 text-xs text-red-700 dark:text-red-300 break-all">
              {walletAddress}
            </div>
          ) : null}
        </div>

        <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2">
          <p>
            To continue, choose one of these options:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Login with this wallet from the login page using the <span className="font-medium">Connect Wallet</span> button.
            </li>
            <li>
              Disconnect this wallet and connect a <span className="font-medium">fresh new wallet</span> to continue with your current account.
            </li>
          </ul>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              window.location.href = '/';
            }}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Go to login page
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            className="flex-1 px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Disconnect wallet
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default WalletInUseModal;

