import type { InvoiceStatus } from "../../features/invoices/invoice.types";
import type { LeadStatus } from "../../features/leads/lead.types";
import type { MemberStatus } from "../../features/members/member.types";
import type { MembershipStatus } from "../../features/memberships/membership.types";
import type { PlanStatus } from "../../features/membership-plans/plan.types";
import type { PaymentStatus } from "../../features/payments/payment.types";

export type BadgeStatus =
  | MemberStatus
  | MembershipStatus
  | PlanStatus
  | InvoiceStatus
  | PaymentStatus
  | LeadStatus
  | "QUEUED"
  | "SENT";

/**
 * Brand green is the "everything is fine" signal, so only ACTIVE gets it. The end states
 * deliberately recede rather than reading as errors — an expired or archived record is a normal
 * outcome, not a failure. FROZEN is the one exception: it is temporary and reversible, so it uses
 * the muted accent to stay visible without claiming something is wrong.
 *
 * Money statuses follow the same logic, with one addition: UNPAID and PARTIALLY_PAID are amber
 * rather than grey, because unlike an expired membership they are *someone's job today*.
 */
const styles: Record<BadgeStatus, string> = {
  ACTIVE: "bg-brand-green/15 text-brand-green border-brand-green/40",
  INACTIVE: "bg-brand-white/10 text-brand-white/70 border-brand-white/25",
  ARCHIVED: "bg-brand-black text-brand-white/40 border-brand-white/15",
  FROZEN: "bg-brand-green-muted/15 text-brand-green-muted border-brand-green-muted/40",
  EXPIRED: "bg-brand-white/10 text-brand-white/60 border-brand-white/25",
  CANCELLED: "bg-brand-black text-brand-white/40 border-brand-white/15",

  // Invoices — PAID is the settled, nothing-to-do state, so it gets the green.
  PAID: "bg-brand-green/15 text-brand-green border-brand-green/40",
  UNPAID: "bg-amber-400/10 text-amber-300 border-amber-400/40",
  PARTIALLY_PAID: "bg-amber-400/10 text-amber-300 border-amber-400/40",
  DRAFT: "bg-brand-white/10 text-brand-white/60 border-brand-white/25",

  // Payments — SUCCESS is green via ACTIVE's sibling; a reversal is a normal outcome, not a fault.
  SUCCESS: "bg-brand-green/15 text-brand-green border-brand-green/40",
  REFUNDED: "bg-brand-white/10 text-brand-white/60 border-brand-white/25",
  PENDING: "bg-amber-400/10 text-amber-300 border-amber-400/40",
  FAILED: "bg-red-500/10 text-red-300 border-red-400/40",

  // Leads — NEW and TRIAL_SCHEDULED are someone's job today; CONVERTED is settled; LOST recedes.
  NEW: "bg-amber-400/10 text-amber-300 border-amber-400/40",
  CONTACTED: "bg-brand-green-muted/15 text-brand-green-muted border-brand-green-muted/40",
  TRIAL_SCHEDULED: "bg-brand-green/15 text-brand-green border-brand-green/40",
  CONVERTED: "bg-brand-green/15 text-brand-green border-brand-green/40",
  LOST: "bg-brand-black text-brand-white/40 border-brand-white/15",

  QUEUED: "bg-amber-400/10 text-amber-300 border-amber-400/40",
  SENT: "bg-brand-green/15 text-brand-green border-brand-green/40",
};

/** `PARTIALLY_PAID` is not a word. */
const labels: Partial<Record<BadgeStatus, string>> = {
  PARTIALLY_PAID: "PART PAID",
  TRIAL_SCHEDULED: "TRIAL",
};

export function StatusBadge({ status }: { status: BadgeStatus }) {
  return (
    <span
      data-testid="status-badge"
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
