import type { ListParams } from "../../lib/url-list-params";

export type InvoiceStatus = "DRAFT" | "UNPAID" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

/** Mirrors `InvoiceResponse` in apps/api/src/modules/invoices/invoice.service.ts. */
export interface Invoice {
  id: string;
  organizationId: string;
  memberId: string;
  membershipId: string | null;
  invoiceNumber: string;
  /** Fixed-2 decimal strings. Immutable once raised (Locked Decision 1.16.2). */
  amountTotal: string;
  amountPaid: string;
  amountPending: string;
  status: InvoiceStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  member: { id: string; firstName: string; lastName: string; phone: string };
  membership: { id: string; planId: string; startDate: string; endDate: string } | null;
}

export type InvoiceSortField = "createdAt" | "invoiceNumber" | "amountTotal" | "amountPending";

export type InvoiceListParams = ListParams<InvoiceSortField, InvoiceStatus>;

export const DEFAULT_INVOICE_LIST_PARAMS: InvoiceListParams = {
  page: 1,
  limit: 10,
  search: "",
  status: "",
  sortBy: "createdAt",
  sortOrder: "desc",
};

/**
 * What the UI may offer on an invoice, derived from the same rules the server enforces
 * (Locked Decision 1.16.2). Hiding a button the API would refuse is a courtesy, not the control —
 * every one of these is re-checked server-side.
 */
export function invoiceActions(invoice: Invoice) {
  const isCancelled = invoice.status === "CANCELLED";
  const owes = Number(invoice.amountPending) > 0;

  return {
    /** A cancelled invoice takes no more money, and a settled one needs none. */
    canRecordPayment: !isCancelled && owes,
    /** Cancelling is only honest while nothing has been collected. */
    canCancel: !isCancelled && Number(invoice.amountPaid) <= 0,
  };
}
