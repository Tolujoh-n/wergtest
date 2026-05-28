import React from 'react';
import { formatUsdFromEth } from '../utils/ethUsdFormat';

/**
 * Shows approximate USD for an ETH amount using backend spot price.
 */
export default function EthUsdHint({ ethAmount, ethUsd, className = '' }) {
  const formatted = formatUsdFromEth(ethAmount, ethUsd);
  if (!formatted) return null;
  const hasTextColor = /\btext-[\w/.%-]+/.test(className);
  const base = hasTextColor ? 'text-xs' : 'text-xs text-gray-500 dark:text-gray-400';
  return (
    <p className={`${base} ${className}`.trim()}>
      ≈ {formatted}
    </p>
  );
}
