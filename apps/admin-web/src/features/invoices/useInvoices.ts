import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSessionStore } from "../../stores/session.store";
import { memberKeys } from "../members/useMembers";
import { cancelInvoice, createInvoice, getInvoice, listInvoices, type InvoicePage } from "./invoices.api";
import type { InvoiceFormValues } from "./invoice.schema";
import type { Invoice, InvoiceListParams } from "./invoice.types";

/** Scoped by organization id so switching tenants can never serve another org's cached rows. */
export const invoiceKeys = {
  all: (organizationId: string) => ["invoices", organizationId] as const,
  list: (organizationId: string, params: unknown) =>
    ["invoices", organizationId, "list", params] as const,
  detail: (organizationId: string, invoiceId: string) =>
    ["invoices", organizationId, "detail", invoiceId] as const,
};

function useOrganizationId(): string {
  const organizationId = useSessionStore((s) => s.organization?.id);
  // Every billing screen sits behind ProtectedRoute, so the session is always populated here.
  return organizationId ?? "";
}

export function useInvoiceList(
  params: InvoiceListParams & { outstanding?: boolean; memberId?: string },
): UseQueryResult<InvoicePage> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: invoiceKeys.list(organizationId, params),
    queryFn: () => listInvoices(organizationId, params),
    enabled: organizationId !== "",
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(invoiceId: string | undefined): UseQueryResult<Invoice> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: invoiceKeys.detail(organizationId, invoiceId ?? ""),
    queryFn: () => getInvoice(organizationId, invoiceId!),
    enabled: organizationId !== "" && Boolean(invoiceId),
  });
}

/**
 * Money moving touches more than one cache: an invoice's totals change, the payment ledger gains
 * a row, and a member's outstanding balance is shown on their detail page. Exported so the
 * payments hooks invalidate exactly the same set rather than each keeping their own list.
 */
export function useInvalidateBilling() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: invoiceKeys.all(organizationId) });
    void queryClient.invalidateQueries({ queryKey: ["payments", organizationId] });
    void queryClient.invalidateQueries({ queryKey: memberKeys.all(organizationId) });
  };
}

export function useCreateInvoice(): UseMutationResult<Invoice, unknown, InvoiceFormValues> {
  const organizationId = useOrganizationId();
  const invalidate = useInvalidateBilling();

  return useMutation({
    mutationFn: (values: InvoiceFormValues) => createInvoice(organizationId, values),
    onSuccess: invalidate,
  });
}

export function useCancelInvoice(): UseMutationResult<Invoice, unknown, string> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateBilling();

  return useMutation({
    mutationFn: (invoiceId: string) => cancelInvoice(organizationId, invoiceId),
    onSuccess: (invoice) => {
      queryClient.setQueryData(invoiceKeys.detail(organizationId, invoice.id), invoice);
      invalidate();
    },
  });
}
