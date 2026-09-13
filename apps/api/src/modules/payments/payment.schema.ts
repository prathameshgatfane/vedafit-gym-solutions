import { z } from "zod";
import { moneyAmountSchema } from "../../utils/money";
import { createListQuerySchema } from "../../utils/pagination";

export const paymentMethodSchema = z.enum(["CASH", "CARD", "UPI", "BANK_TRANSFER", "OTHER"]);
export const paymentStatusSchema = z.enum(["SUCCESS", "FAILED", "REFUNDED", "PENDING"]);

/**
 * A payment is always recorded against an invoice. Money with nothing to reconcile against is
 * money nobody can explain later, and the invoice is what carries the member, the term and the
 * amount owed — so `memberId`/`membershipId` are copied from it rather than accepted here.
 *
 * The amount must be positive: a negative payment is a refund, and refunds have their own route
 * so they can carry their own permission and audit entry (Locked Decision 1.16.3).
 */
export const createPaymentSchema = z.object({
  invoiceId: z.string().trim().min(1, "Invoice is required"),
  amount: moneyAmountSchema("Amount", { positive: true }),
  method: paymentMethodSchema,
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

/**
 * Partial refunds are allowed, so the amount is explicit rather than "all of it". `reason` is
 * not stored on the payment row — it goes into the `AuditLog` entry, which is where the story of
 * why money went back belongs.
 */
export const refundPaymentSchema = z.object({
  amount: moneyAmountSchema("Refund amount", { positive: true }),
  reason: z.string().trim().max(500).optional(),
});
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

export const paymentParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  paymentId: z.string().trim().min(1).optional(),
});

export const listPaymentsQuerySchema = createListQuerySchema([
  "paidAt",
  "amount",
  "createdAt",
]).extend({
  status: paymentStatusSchema.optional(),
  method: paymentMethodSchema.optional(),
  memberId: z.string().trim().min(1).optional(),
  invoiceId: z.string().trim().min(1).optional(),
  membershipId: z.string().trim().min(1).optional(),
});
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
