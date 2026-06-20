/** Default: 1 golden ticket per $10 USDC staked (matches backend default). */
export const DEFAULT_GOLDEN_TICKET_BOOST_RATE = { tickets: 1, perUsdc: 10 };

export function normalizeGoldenTicketBoostRate(raw) {
  if (raw && typeof raw === 'object' && Number(raw.perUsdc) > 0) {
    return {
      tickets: Math.max(0, parseInt(raw.tickets, 10) || 1),
      perUsdc: Math.max(0.01, Number(raw.perUsdc) || DEFAULT_GOLDEN_TICKET_BOOST_RATE.perUsdc),
    };
  }
  return { ...DEFAULT_GOLDEN_TICKET_BOOST_RATE };
}

/** Golden tickets earned for a gross USDC boost stake (rounded to nearest whole). */
export function goldenTicketsForBoostStake(stakeUsdc, rate = DEFAULT_GOLDEN_TICKET_BOOST_RATE) {
  const amt = Number(stakeUsdc) || 0;
  const { tickets, perUsdc } = normalizeGoldenTicketBoostRate(rate);
  if (!(amt > 0) || !(perUsdc > 0) || !(tickets > 0)) return 0;
  return Math.round((amt / perUsdc) * tickets);
}

export function formatGoldenTicketRateLabel(rate = DEFAULT_GOLDEN_TICKET_BOOST_RATE) {
  const { tickets, perUsdc } = normalizeGoldenTicketBoostRate(rate);
  const ticketWord = tickets === 1 ? 'golden ticket' : 'golden tickets';
  return `${tickets} ${ticketWord} per $${perUsdc} USDC staked`;
}
