import type { ListParams } from "../../lib/url-list-params";

export type PaymentMethod = "CASH" | "CARD" | "UPI" | "BANK_TRANSFER" | "OTHER";
export type PaymentStatus = "SUCCESS" | "FAILED" | "REFUNDED" | "PENDING";

/** Mirrors `PaymentResponse` in apps/api/src/modules/payments/payment.service.ts. */
export interface Payment {
  id: string;
  organizationId: string;
  memberId: string;
  membershipId: string | null;
  invoiceId: string | null;
  /** Negative on a refund row (Locked Decision 1.16.3). Fixed-2 string — format, don't compute. */
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  refundOfPaymentId: string | null;
  isRefund: boolean;
  paidAt: string;
  createdAt: string;
  member: { id: string; firstName: string; lastName: string; phone: string };
  invoice: { id: string; invoiceNumber: string; amountTotal: string; status: string } | null;
}

export type PaymentSortField = "paidAt" | "amount" | "createdAt";

export type PaymentListParams = ListParams<PaymentSortField, PaymentStatus>;

export const DEFAULT_PAYMENT_LIST_PARAMS: PaymentListParams = {
  page: 1,
  limit: 10,
  search: "",
  status: "",
  sortBy: "paidAt",
  sortOrder: "desc",
};

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

/**
 * Only a successful, non-reversal payment can be refunded (Locked Decision 1.16.3). Whether any
 * of it is *left* to refund is the server's call — it holds the running total — so this is the
 * cheap half of the check and the API is still the authority.
 */
export function isRefundable(payment: Payment): boolean {
  return !payment.isRefund && payment.status === "SUCCESS";
}
