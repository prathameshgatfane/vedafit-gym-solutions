import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type { Invoice } from "../invoices/invoice.types";
import type { Payment, PaymentListParams, PaymentMethod } from "./payment.types";

export interface PaymentPage {
  items: Payment[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function path(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/payments${suffix}`;
}

export type PaymentFilters = PaymentListParams & { invoiceId?: string; memberId?: string };

function toQuery(params: PaymentFilters) {
  const query: Record<string, string | number> = {
    page: params.page,
    limit: params.limit,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };
  if (params.search.trim()) query.search = params.search.trim();
  if (params.status) query.status = params.status;
  if (params.invoiceId) query.invoiceId = params.invoiceId;
  if (params.memberId) query.memberId = params.memberId;
  return query;
}

export async function listPayments(
  organizationId: string,
  params: PaymentFilters,
): Promise<PaymentPage> {
  const { data } = await apiClient.get<ApiPaginated<Payment>>(path(organizationId), {
    params: toQuery(params),
  });
  return { items: data.data, pagination: data.pagination };
}

/**
 * Recording a payment returns the invoice as well as the payment, because the invoice's totals
 * and status are recomputed in the same transaction (1.16.2) — the caller shouldn't have to
 * re-fetch to find out what the bill now says.
 */
export async function recordPayment(
  organizationId: string,
  input: { invoiceId: string; amount: number; method: PaymentMethod },
): Promise<{ payment: Payment; invoice: Invoice }> {
  const { data } = await apiClient.post<ApiSuccess<{ payment: Payment; invoice: Invoice }>>(
    path(organizationId),
    input,
  );
  return data.data;
}

/**
 * A refund never edits the payment it reverses — it adds a negative row pointing at it
 * (1.16.3). The response carries all three affected things: the new row, the untouched original,
 * and the recomputed invoice.
 */
export async function refundPayment(
  organizationId: string,
  paymentId: string,
  input: { amount: number; reason?: string },
): Promise<{ refund: Payment; original: Payment; invoice: Invoice | null }> {
  const { data } = await apiClient.post<
    ApiSuccess<{ refund: Payment; original: Payment; invoice: Invoice | null }>
  >(path(organizationId, `/${paymentId}/refund`), input);
  return data.data;
}
