import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../utils/api';
import { useNotification } from '../components/Notification';
import Modal from '../components/Modal';
import TargetOddsInputs from '../components/TargetOddsInputs';
import {
  pctRowsFromStartingPrices,
  startingPricesFromPctRows,
} from '../utils/targetOdds';

function getOutcomeKeys(item, kind) {
  if (kind === 'poll') {
    const opts = (item?.options || []).map((o) => String(o?.text || '').trim()).filter(Boolean);
    if (opts.length) return opts;
    return ['YES', 'NO'];
  }
  const keys = ['TeamA'];
  if (item?.drawEnabled !== false) keys.push('Draw');
  keys.push('TeamB');
  return keys;
}

function buildPauseByOptionRows(item, kind, control) {
  const keys = getOutcomeKeys(item, kind);
  const list = control?.pauseByOption || [];
  return keys.map((optionKey) => {
    const row = list.find((r) => String(r.optionKey) === String(optionKey)) || {};
    return {
      optionKey,
      pauseYes: !!row.pauseYes,
      pauseNo: !!row.pauseNo,
    };
  });
}

function buildStartingPriceRows(item, kind) {
  const keys = getOutcomeKeys(item, kind);
  const list = item?.startingPrices || [];
  return keys.map((optionKey) => {
    const row = list.find((r) => String(r.optionKey) === String(optionKey)) || {};
    return {
      optionKey,
      yesPrice: Number(row.yesPrice ?? 0.5),
      noPrice: Number(row.noPrice ?? 0.5),
      quoteVolumeUsdc: Number(row.quoteVolumeUsdc) || 200,
    };
  });
}

function outcomeLabel(optionKey, item, kind) {
  if (kind === 'poll') return optionKey;
  if (optionKey === 'TeamA') return item?.teamA || 'Team A';
  if (optionKey === 'TeamB') return item?.teamB || 'Team B';
  if (optionKey === 'Draw') return 'Draw';
  return optionKey;
}

/**
 * Per-market admin control: spreads, pauses, risk caps, MM bot status (Polymarket-style operations).
 */
const AdminMarketControl = () => {
  const { kind, id } = useParams();
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState(null);
  const [control, setControl] = useState(null);
  const [defaults, setDefaults] = useState(null);
  const [botOpen, setBotOpen] = useState(false);
  const [form, setForm] = useState({});
  const [botStats, setBotStats] = useState(null);
  const [botStatsLoading, setBotStatsLoading] = useState(false);
  const [mmActor, setMmActor] = useState(null);
  const [mmWalletInput, setMmWalletInput] = useState('');
  const [mmSaving, setMmSaving] = useState(false);
  const [treasurySaving, setTreasurySaving] = useState(false);
  const [mmTickModalOpen, setMmTickModalOpen] = useState(false);
  const [mmTickLoading, setMmTickLoading] = useState(false);
  const [mmVault, setMmVault] = useState(null);
  const [pauseByOption, setPauseByOption] = useState([]);
  const [targetOdds, setTargetOdds] = useState([]);
  const [botSaving, setBotSaving] = useState(false);

  const basePath = kind === 'poll' ? `/admin/orderbook/polls/${id}` : `/admin/orderbook/matches/${id}`;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [docRes, defRes, actorRes] = await Promise.all([
        api.get(basePath),
        api.get('/admin/orderbook/defaults'),
        api.get('/admin/orderbook/mm-actor').catch(() => ({ data: {} })),
      ]);
      setItem(docRes.data.item);
      setControl(docRes.data.control);
      setDefaults(defRes.data);
      setMmActor(actorRes.data || null);
      setMmWalletInput(actorRes.data?.walletAddress || '');
      const c = docRes.data.control || {};
      const docItem = docRes.data.item;
      setPauseByOption(buildPauseByOptionRows(docItem, kind, c));
      setTargetOdds(pctRowsFromStartingPrices(buildStartingPriceRows(docItem, kind)));
      setForm({
        spreadBps: c.spreadBps ?? 80,
        minSpreadFloorBps: c.minSpreadFloorBps ?? 20,
        quoteSizeUsdc: c.quoteSizeUsdc ?? 50,
        maxSlippageBps: c.maxSlippageBps ?? 300,
        maxTreasuryLossUsdc: c.maxTreasuryLossUsdc ?? 100000,
        maxTreasuryLossYesUsdc: c.maxTreasuryLossYesUsdc ?? 50000,
        maxTreasuryLossNoUsdc: c.maxTreasuryLossNoUsdc ?? 50000,
        widenSpreadYesCapUsdc: c.widenSpreadYesCapUsdc ?? 0,
        widenSpreadNoCapUsdc: c.widenSpreadNoCapUsdc ?? 0,
        maxMarketAllocationUsdc: c.maxMarketAllocationUsdc ?? 250000,
        marketPaused: !!c.marketPaused,
        pauseSideYes: !!c.pauseSideYes,
        pauseSideNo: !!c.pauseSideNo,
        botEnabled: c.botEnabled !== false,
        enabled: c.enabled !== false,
      });
    } catch (e) {
      showNotification(e.response?.data?.message || e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [basePath, showNotification, kind]);

  const fetchMmVault = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/orderbook/mm-vault');
      setMmVault(data);
    } catch {
      setMmVault(null);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    fetchMmVault();
  }, [fetchAll, fetchMmVault]);

  const save = async () => {
    try {
      await api.put(basePath, { ...form, pauseByOption });
      showNotification('Market controls saved', 'success');
      fetchAll();
    } catch (e) {
      showNotification(e.response?.data?.message || e.message, 'error');
    }
  };

  const saveBotSettings = async () => {
    setBotSaving(true);
    const startingPrices = startingPricesFromPctRows(targetOdds);
    try {
      await api.put(basePath, {
        ...form,
        pauseByOption,
        startingPrices,
      });
      setBotOpen(false);
      setBotSaving(false);
      showNotification('Bot settings saved — quotes updating in background', 'success');
      fetchAll().catch(() => {});
    } catch (e) {
      showNotification(e.response?.data?.message || e.message, 'error');
      setBotSaving(false);
    }
  };

  const updatePauseByOption = (optionKey, field, checked) => {
    setPauseByOption((prev) =>
      prev.map((row) =>
        row.optionKey === optionKey ? { ...row, [field]: checked } : row
      )
    );
  };

  const saveTreasuryCaps = async () => {
    setTreasurySaving(true);
    try {
      await api.put(basePath, {
        maxMarketAllocationUsdc: Number(form.maxMarketAllocationUsdc) || 0,
        maxTreasuryLossUsdc: Number(form.maxTreasuryLossUsdc) || 0,
        maxTreasuryLossYesUsdc: Number(form.maxTreasuryLossYesUsdc) || 0,
        maxTreasuryLossNoUsdc: Number(form.maxTreasuryLossNoUsdc) || 0,
        widenSpreadYesCapUsdc: Number(form.widenSpreadYesCapUsdc) || 0,
        widenSpreadNoCapUsdc: Number(form.widenSpreadNoCapUsdc) || 0,
      });
      showNotification('Treasury & risk caps saved', 'success');
      fetchAll();
    } catch (e) {
      showNotification(e.response?.data?.message || e.message, 'error');
    } finally {
      setTreasurySaving(false);
    }
  };

  const runMmTick = async () => {
    try {
      const { data } = await api.post(`${basePath}/mm-tick`);
      showNotification(data.skipped ? 'Bot skipped' : 'MM quotes placed', 'success');
      fetchAll();
      return data;
    } catch (e) {
      showNotification(e.response?.data?.message || e.message, 'error');
      throw e;
    }
  };

  const confirmRunMmTick = async () => {
    setMmTickLoading(true);
    try {
      await runMmTick();
      setMmTickModalOpen(false);
    } catch {
      /* notification already shown */
    } finally {
      setMmTickLoading(false);
    }
  };

  const saveMmWallet = async () => {
    const w = String(mmWalletInput || '').trim();
    if (!w) {
      showNotification('Enter a wallet address', 'warning');
      return;
    }
    setMmSaving(true);
    try {
      const { data } = await api.put('/admin/orderbook/mm-actor', { walletAddress: w });
      setMmActor(data);
      setMmWalletInput(data.walletAddress || w);
      showNotification('Market maker wallet saved', 'success');
    } catch (e) {
      showNotification(e.response?.data?.message || e.message, 'error');
    } finally {
      setMmSaving(false);
    }
  };

  const fetchBotStats = useCallback(async () => {
    if (!item?.marketId) return;
    setBotStatsLoading(true);
    try {
      const optionKeys =
        kind === 'poll'
          ? (item?.options || []).map((o) => String(o?.text || '').trim()).filter(Boolean)
          : ['TeamA', 'Draw', 'TeamB'];

      const marketId = item.marketId;
      const readSide = async (optionKey, side) => {
        const { data } = await api.get(`/orderbook/book/${marketId}`, { params: { optionKey, side } });
        const bids = data?.bids || [];
        const asks = data?.asks || [];
        const bestBid = bids.length ? Number(bids[0].limitPrice) : null;
        const bestAsk = asks.length ? Number(asks[0].limitPrice) : null;
        const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
        return { bestBid, bestAsk, spread, bids, asks };
      };

      const rows = [];
      for (const optionKey of optionKeys) {
        const [yes, no] = await Promise.all([readSide(optionKey, 'YES'), readSide(optionKey, 'NO')]);
        rows.push({ optionKey, YES: yes, NO: no });
      }

      setBotStats({
        marketId,
        optionCount: optionKeys.length,
        rows,
        ts: new Date().toISOString(),
      });
    } catch (e) {
      setBotStats(null);
    } finally {
      setBotStatsLoading(false);
    }
  }, [item?.marketId, item?.options, kind]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10 text-center text-gray-600 dark:text-gray-400">
        Loading control panel…
      </div>
    );
  }

  if (!item) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10">
        <p className="text-red-600">Market not found.</p>
        <Link to="/admin" className="text-blue-600 underline mt-4 inline-block">
          Back to admin
        </Link>
      </div>
    );
  }

  const title =
    kind === 'poll'
      ? item.question
      : `${item.teamA} vs ${item.teamB}`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <Link to="/admin" className="text-sm text-blue-600 hover:underline">
            ← Admin
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">Market control</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">{title}</p>
          <p className="text-xs text-gray-500 mt-1">Chain market ID: {item.marketId ?? '—'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setBotOpen(true)}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm hover:bg-slate-900"
          >
            Bot
          </button>
          {item?.marketId && (
            <button
              type="button"
              onClick={() => setMmTickModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700"
            >
              Run MM tick
            </button>
          )}
          <button
            type="button"
            onClick={save}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>

      {defaults && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-6">
          Global defaults (Settings <code>orderbookDefaults</code>): spread {defaults.spreadBps} bps · floor{' '}
          {defaults.minSpreadFloorBps} bps · quote {defaults.quoteSizeUsdc} USDC
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4 md:col-span-2">
          <h2 className="font-semibold text-gray-900 dark:text-white">Market maker bot (global)</h2>
          <p className="text-xs text-gray-500">
            This wallet is used by the platform-controlled market maker to place quotes. The backend will link this wallet
            to an internal <code>market-maker-bot</code> user automatically. Deposit USDC on the Wallet page while connected
            as this address.
          </p>
          {mmVault && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 text-sm space-y-1">
              <div>
                Vault: <strong>{Number(mmVault.onChainVaultUsdc || 0).toFixed(2)} USDC</strong>
                {' · '}
                Reserved: {Number(mmVault.reservedUsdc || 0).toFixed(2)} USDC
                {' · '}
                Withdrawable:{' '}
                <strong className="text-emerald-700 dark:text-emerald-400">
                  {Number(mmVault.availableUsdc || 0).toFixed(2)} USDC
                </strong>
              </div>
              <button type="button" onClick={fetchMmVault} className="text-xs text-blue-600 hover:underline">
                Refresh vault
              </button>
            </div>
          )}
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Bot wallet address</label>
              <input
                type="text"
                className="w-full px-3 py-2 rounded-lg border dark:bg-gray-700 dark:text-white"
                value={mmWalletInput}
                onChange={(e) => setMmWalletInput(e.target.value)}
                placeholder="0x..."
              />
            </div>
            <button
              type="button"
              onClick={saveMmWallet}
              disabled={mmSaving}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {mmSaving ? 'Saving…' : 'Save wallet'}
            </button>
          </div>
          {mmActor?.userId ? (
            <div className="text-xs text-gray-500">
              Internal userId: <code>{mmActor.userId}</code>
            </div>
          ) : null}
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-white">Trading & pauses</h2>
          {(control?.riskPausedMarket ||
            control?.riskPausedYes ||
            control?.riskPausedNo) && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-100 space-y-1">
              <div className="font-semibold">Automatic risk halts (market maker)</div>
              {control?.riskPausedMarket ? (
                <div>Entire market paused: max allocation or max treasury loss (USDC) reached.</div>
              ) : null}
              {control?.riskPausedYes ? <div>YES side paused: max loss YES exposure (USDC) reached.</div> : null}
              {control?.riskPausedNo ? <div>NO side paused: max loss NO exposure (USDC) reached.</div> : null}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Orderbook enabled
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.marketPaused}
              onChange={(e) => setForm({ ...form, marketPaused: e.target.checked })}
            />
            Pause entire market
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.pauseSideYes}
              onChange={(e) => setForm({ ...form, pauseSideYes: e.target.checked })}
            />
            Pause YES side (all outcomes)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.pauseSideNo}
              onChange={(e) => setForm({ ...form, pauseSideNo: e.target.checked })}
            />
            Pause NO side (all outcomes)
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Manual toggles above apply immediately after Save. Risk halts stack on top: the bot updates them from
            Treasury & risk caps; matching uses either kind of pause.
          </p>

          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Per-outcome pause
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Pause YES or NO for a specific outcome. Global pauses above still apply to all outcomes.
            </p>
            <div className="space-y-3">
              {pauseByOption.map((row) => (
                <div
                  key={row.optionKey}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40"
                >
                  <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                    {outcomeLabel(row.optionKey, item, kind)}
                    <span className="text-xs text-gray-500 ml-2">({row.optionKey})</span>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={row.pauseYes}
                        onChange={(e) => updatePauseByOption(row.optionKey, 'pauseYes', e.target.checked)}
                      />
                      Pause YES
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={row.pauseNo}
                        onChange={(e) => updatePauseByOption(row.optionKey, 'pauseNo', e.target.checked)}
                      />
                      Pause NO
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-white">Quotes & slippage</h2>
          {[
            ['spreadBps', 'Target spread (bps)'],
            ['minSpreadFloorBps', 'Minimum spread floor (bps)'],
            ['quoteSizeUsdc', 'Quote size (USDC notional)'],
            ['maxSlippageBps', 'Max slippage guard (bps)'],
          ].map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 mb-1">{label}</label>
              <input
                type="number"
                className="w-full px-3 py-2 rounded-lg border dark:bg-gray-700 dark:text-white"
                value={form[key] ?? ''}
                onChange={(e) => setForm({ ...form, [key]: parseFloat(e.target.value) || 0 })}
              />
            </div>
          ))}
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 space-y-4 md:col-span-2">
          <h2 className="font-semibold text-gray-900 dark:text-white">Treasury & risk caps</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              ['maxMarketAllocationUsdc', 'Max allocation per market (USDC)'],
              ['maxTreasuryLossUsdc', 'Max treasury loss (USDC)'],
              ['maxTreasuryLossYesUsdc', 'Max loss YES exposure (USDC)'],
              ['maxTreasuryLossNoUsdc', 'Max loss NO exposure (USDC)'],
              ['widenSpreadYesCapUsdc', 'Widen spread at YES exposure (USDC)'],
              ['widenSpreadNoCapUsdc', 'Widen spread at NO exposure (USDC)'],
            ].map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs text-gray-500 mb-1">{label}</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg border dark:bg-gray-700 dark:text-white"
                  value={form[key] ?? ''}
                  onChange={(e) => setForm({ ...form, [key]: parseFloat(e.target.value) || 0 })}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={saveTreasuryCaps}
              disabled={treasurySaving}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {treasurySaving ? 'Saving…' : 'Save treasury & risk caps'}
            </button>
            <span className="text-xs text-gray-500">Use this button for caps only; the main Save updates quotes, pauses, and bot.</span>
          </div>
          <p className="text-xs text-gray-500">
            Caps are enforced on every order and on each MM maintenance tick. Max treasury loss uses mark-to-mid on MM
            positions (book mid when available, else 0.5). Widen-spread thresholds cancel and replace MM quotes with a
            wider spread until exposure drops.
          </p>
        </section>
      </div>

      <Modal isOpen={botOpen} onClose={() => setBotOpen(false)} title="Market maker bot" size="lg">
        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
          <p>
            The bot maintains resting quotes using spread / quote size above. When enabled, scheduled maintenance expires
            stale orders; use <strong>Run MM tick</strong> on the market control page to place symmetric bids/asks from the configured
            treasury wallet (<code>MARKET_MAKER_USER_ID</code>).
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.botEnabled}
              onChange={(e) => setForm({ ...form, botEnabled: e.target.checked })}
            />
            Bot enabled for this market
          </label>
          <p className="text-xs text-gray-500">
            Last tick: {control?.botLastTickAt ? new Date(control.botLastTickAt).toLocaleString() : '—'}
          </p>
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">Live market snapshot</div>
              <button
                type="button"
                onClick={fetchBotStats}
                className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-xs hover:bg-slate-800"
              >
                Refresh
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Best bid/ask/spread per option side (from current orderbook). {botStats?.ts ? `Updated: ${new Date(botStats.ts).toLocaleTimeString()}` : ''}
            </p>

            {botStatsLoading ? (
              <div className="text-xs text-gray-500 mt-3">Loading…</div>
            ) : botStats?.rows?.length ? (
              <div className="mt-3 space-y-2">
                {botStats.rows.map((r) => (
                  <div key={r.optionKey} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-800">
                    <div className="font-semibold text-gray-900 dark:text-white mb-2">{r.optionKey}</div>
                    {['YES', 'NO'].map((s) => {
                      const x = r[s];
                      return (
                        <div key={s} className="text-xs flex flex-wrap items-center justify-between gap-2 py-1">
                          <div className="font-semibold">{s}</div>
                          <div className="text-gray-600 dark:text-gray-300">
                            bid {x.bestBid != null ? x.bestBid.toFixed(3) : '—'} · ask {x.bestAsk != null ? x.bestAsk.toFixed(3) : '—'} · spread{' '}
                            {x.spread != null ? x.spread.toFixed(3) : '—'}
                          </div>
                          <div className="text-gray-500">
                            depth bids {x.bids?.length || 0} · asks {x.asks?.length || 0}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-gray-500 mt-3">No book data yet.</div>
            )}
          </div>

          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Target odds (%)</h3>
            <p className="text-xs text-gray-500 mb-3">
              Set the outcome percentages the market maker works toward (same as market detail display). Saving updates
              target prices and requotes in the background.
            </p>
            <TargetOddsInputs
              rows={targetOdds}
              balanceOptionKey={kind === 'match' ? 'TeamB' : targetOdds[targetOdds.length - 1]?.optionKey}
              onUpdateRows={setTargetOdds}
              getLabel={(optionKey) => outcomeLabel(optionKey, item, kind)}
              compact
            />
          </div>

          <button
            type="button"
            disabled={botSaving}
            onClick={saveBotSettings}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {botSaving ? 'Saving…' : 'Save bot settings'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={mmTickModalOpen} onClose={() => !mmTickLoading && setMmTickModalOpen(false)} title="Run market maker tick" size="md">
        <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
          <p className="leading-relaxed">
            This button runs <strong>one manual pass</strong> of the market-maker for <strong>this market only</strong> (it does not run the global scheduled job for all markets).
          </p>
          <ul className="list-disc pl-5 space-y-2 leading-relaxed">
            <li>
              Uses the <strong>configured bot wallet</strong> (global MM actor) to place or refresh resting limit bids and asks on the off-chain orderbook, per outcome and YES/NO side, using this market&apos;s spread, floor, and quote size.
            </li>
            <li>
              <strong>Risk caps</strong> are re-evaluated first (allocation, treasury loss estimate, per-side exposure). Automatic risk halts are updated so trading rules match before any new quotes go out.
            </li>
            <li>
              If <strong>widen-spread</strong> exposure thresholds are met, existing bot orders on that side may be cancelled so new quotes can be posted with a wider spread and smaller size.
            </li>
            <li>
              If the bot is disabled for this market, the MM wallet is missing, the market is not tradable, or a full-market risk halt applies, the run may <strong>skip</strong> placing quotes (you will see a &quot;Bot skipped&quot; message).
            </li>
          </ul>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Scheduled maintenance still runs in the background; use this when you want an immediate refresh after changing settings or liquidity.
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              disabled={mmTickLoading}
              onClick={() => setMmTickModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={mmTickLoading}
              onClick={confirmRunMmTick}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {mmTickLoading ? 'Running…' : 'Confirm & run tick'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AdminMarketControl;
