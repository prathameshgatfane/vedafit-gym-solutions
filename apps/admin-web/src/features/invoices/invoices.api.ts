import { apiClient, type ApiPaginated, type ApiSuccess } from "../../lib/api-client";
import type { InvoiceFormValues } from "./invoice.schema";
import type { Invoice, InvoiceListParams } from "./invoice.types";

export interface InvoicePage {
  items: Invoice[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function path(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/invoices${suffix}`;
}

/** Empty filters are dropped rather than sent blank, so the URL says what it means. */
function toQuery(params: InvoiceListParams & { outstanding?: boolean; memberId?: string }) {
  const query: Record<string, string | number> = {
    page: params.page,
    limit: params.limit,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };
  if (params.search.trim()) query.search = params.search.trim();
  if (params.status) query.status = params.status;
  if (params.outstanding) query.outstanding = "true";
  if (params.memberId) query.memberId = params.memberId;
  return query;
}

export async function listInvoices(
  organizationId: string,
  params: InvoiceListParams & { outstanding?: boolean; memberId?: string },
): Promise<InvoicePage> {
  const { data } = await apiClient.get<ApiPaginated<Invoice>>(path(organizationId), {
    params: toQuery(params),
  });
  return { items: data.data, pagination: data.pagination };
}

export async function getInvoice(organizationId: string, invoiceId: string): Promise<Invoice> {
  const { data } = await apiClient.get<ApiSuccess<Invoice>>(path(organizationId, `/${invoiceId}`));
  return data.data;
}

export async function createInvoice(
  organizationId: string,
  values: InvoiceFormValues,
): Promise<Invoice> {
  const { data } = await apiClient.post<ApiSuccess<Invoice>>(path(organizationId), {
    memberId: values.memberId,
    // The form holds text; the API wants a number. One place converts.
    amountTotal: Number(values.amountTotal),
    notes: values.notes,
  });
  return data.data;
}

/** Correcting a bill is cancel-and-reissue — `amountTotal` is immutable (1.16.2). */
export async function cancelInvoice(
  organizationId: string,
  invoiceId: string,
): Promise<Invoice> {
  const { data } = await apiClient.post<ApiSuccess<Invoice>>(
    path(organizationId, `/${invoiceId}/cancel`),
  );
  return data.data;
}
