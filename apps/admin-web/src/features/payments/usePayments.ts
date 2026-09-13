import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSessionStore } from "../../stores/session.store";
import { invoiceKeys, useInvalidateBilling } from "../invoices/useInvoices";
import type { Invoice } from "../invoices/invoice.types";
import {
  listPayments,
  recordPayment,
  refundPayment,
  type PaymentFilters,
  type PaymentPage,
} from "./payments.api";
import type { Payment, PaymentMethod } from "./payment.types";

export const paymentKeys = {
  all: (organizationId: string) => ["payments", organizationId] as const,
  list: (organizationId: string, params: unknown) =>
    ["payments", organizationId, "list", params] as const,
};

function useOrganizationId(): string {
  const organizationId = useSessionStore((s) => s.organization?.id);
  return organizationId ?? "";
}

export function usePaymentList(params: PaymentFilters): UseQueryResult<PaymentPage> {
  const organizationId = useOrganizationId();

  return useQuery({
    queryKey: paymentKeys.list(organizationId, params),
    queryFn: () => listPayments(organizationId, params),
    enabled: organizationId !== "",
    placeholderData: keepPreviousData,
  });
}

export function useRecordPayment(): UseMutationResult<
  { payment: Payment; invoice: Invoice },
  unknown,
  { invoiceId: string; amount: number; method: PaymentMethod }
> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateBilling();

  return useMutation({
    mutationFn: (input: { invoiceId: string; amount: number; method: PaymentMethod }) =>
      recordPayment(organizationId, input),
    onSuccess: ({ invoice }) => {
      // The API already recomputed the invoice, so seed it rather than making the detail page
      // wait for a refetch to show the new balance.
      queryClient.setQueryData(invoiceKeys.detail(organizationId, invoice.id), invoice);
      invalidate();
    },
  });
}

export function useRefundPayment(): UseMutationResult<
  { refund: Payment; original: Payment; invoice: Invoice | null },
  unknown,
  { paymentId: string; amount: number; reason?: string }
> {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateBilling();

  return useMutation({
    mutationFn: ({ paymentId, amount, reason }: { paymentId: string; amount: number; reason?: string }) =>
      refundPayment(organizationId, paymentId, { amount, reason }),
    onSuccess: ({ invoice }) => {
      if (invoice) {
        queryClient.setQueryData(invoiceKeys.detail(organizationId, invoice.id), invoice);
      }
      invalidate();
    },
  });
}
