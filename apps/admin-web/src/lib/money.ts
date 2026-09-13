/**
 * The API sends money as fixed-2 decimal **strings**, never as JSON numbers, so a `Decimal(10,2)`
 * can't lose a paisa on the way through IEEE-754. Format them; never do arithmetic on them.
 *
 * Lived in `features/membership-plans/plan.types.ts` until Phase 6, when invoices and payments
 * became its second and third callers and "the plans module" stopped being the honest home for it.
 */

/**
 * Rupees, because that's the market this is built for. The currency isn't configurable yet
 * (see DEVELOPMENT_PLAN.md Section 9), so it lives here rather than at a dozen call sites.
 */
export function formatPrice(amount: string): string {
  return `₹${Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A refund is stored as a negative amount (Locked Decision 1.16.3). On a ledger the minus sign
 * belongs outside the currency symbol — `−₹250.00`, not `₹-250.00`.
 */
export function formatSignedPrice(amount: string): string {
  const value = Number(amount);
  return value < 0 ? `−${formatPrice(Math.abs(value).toFixed(2))}` : formatPrice(amount);
}

/** "30 days" reads worse than "1 month" on a pricing screen once the numbers get round. */
export function formatDuration(days: number): string {
  if (days % 365 === 0) return `${days / 365} year${days === 365 ? "" : "s"}`;
  if (days % 30 === 0) return `${days / 30} month${days === 30 ? "" : "s"}`;
  return `${days} days`;
}
