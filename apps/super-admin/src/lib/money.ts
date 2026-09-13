/** API money is a fixed-2 decimal string. Format only — never compute entitlements or totals. */
export function formatPrice(amount: string): string {
  return `₹${Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
