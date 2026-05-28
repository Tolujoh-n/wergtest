import { useState, useEffect } from 'react';
import api from '../utils/api';

/**
 * Latest USDC/USD from backend (CoinGecko, refreshed every ~5 min on server).
 * Note: function name kept for backwards compatibility.
 * @returns {{ ethUsd: number|null, lastUpdated: string|null, loading: boolean }}
 */
export function useEthPrice() {
  const [ethUsd, setEthUsd] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchPrice = async () => {
      try {
        const { data } = await api.get('/eth-price/eth');
        if (!cancelled && data?.usd != null && !Number.isNaN(Number(data.usd))) {
          setEthUsd(Number(data.usd));
          setLastUpdated(data.lastUpdated ? String(data.lastUpdated) : null);
        }
      } catch {
        if (!cancelled) {
          /* keep previous ethUsd */
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPrice();
    const id = setInterval(fetchPrice, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { ethUsd, lastUpdated, loading };
}
