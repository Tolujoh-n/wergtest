/** @param {string|number} ethAmount */
export function formatUsdFromEth(ethAmount, ethUsdPerEth) {
  const n = typeof ethAmount === 'string' ? parseFloat(ethAmount) : Number(ethAmount);
  if (ethUsdPerEth == null || Number.isNaN(n) || n <= 0) return null;
  const usd = n * ethUsdPerEth;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n * ethUsdPerEth < 1 ? 4 : 2,
    minimumFractionDigits: 0,
  }).format(usd);
}
