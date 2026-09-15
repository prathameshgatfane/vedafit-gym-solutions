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
  ACTIVE: "bg-accent/15 text-accent-text border-accent/40",
  INACTIVE: "bg-fg/10 text-fg/70 border-fg/25",
  ARCHIVED: "bg-bg text-fg-muted border-fg/15",
  FROZEN: "bg-accent-muted/15 text-accent-muted border-accent-muted/40",
  EXPIRED: "bg-fg/10 text-fg-muted border-fg/25",
  CANCELLED: "bg-bg text-fg-muted border-fg/15",

  // Invoices — PAID is the settled, nothing-to-do state, so it gets the green.
  PAID: "bg-accent/15 text-accent-text border-accent/40",
  UNPAID: "bg-warning/10 text-warning border-warning/40",
  PARTIALLY_PAID: "bg-warning/10 text-warning border-warning/40",
  DRAFT: "bg-fg/10 text-fg-muted border-fg/25",

  // Payments — SUCCESS is green via ACTIVE's sibling; a reversal is a normal outcome, not a fault.
  SUCCESS: "bg-accent/15 text-accent-text border-accent/40",
  REFUNDED: "bg-fg/10 text-fg-muted border-fg/25",
  PENDING: "bg-warning/10 text-warning border-warning/40",
  FAILED: "bg-danger/10 text-danger border-danger/40",

  // Leads — NEW and TRIAL_SCHEDULED are someone's job today; CONVERTED is settled; LOST recedes.
  NEW: "bg-warning/10 text-warning border-warning/40",
  CONTACTED: "bg-accent-muted/15 text-accent-muted border-accent-muted/40",
  TRIAL_SCHEDULED: "bg-accent/15 text-accent-text border-accent/40",
  CONVERTED: "bg-accent/15 text-accent-text border-accent/40",
  LOST: "bg-bg text-fg-muted border-fg/15",

  QUEUED: "bg-warning/10 text-warning border-warning/40",
  SENT: "bg-accent/15 text-accent-text border-accent/40",
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
