import { z } from "zod";
import { moneyAmountSchema } from "../../utils/money";
import { createListQuerySchema } from "../../utils/pagination";

export const invoiceStatusSchema = z.enum([
  "DRAFT",
  "UNPAID",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
]);

/**
 * An ad-hoc invoice — a joining fee, personal training, merchandise. Invoices for membership
 * terms are raised by the memberships module itself, not through this endpoint, so there is no
 * way to bill a term twice by hand.
 *
 * `amountTotal` is allowed to be zero (a complimentary item still deserves a record); it is the
 * one case that lands as `PAID` with no payment rows, per Locked Decision 1.16.2.
 */
export const createInvoiceSchema = z.object({
  memberId: z.string().trim().min(1, "Member is required"),
  amountTotal: moneyAmountSchema("Amount"),
  notes: z.string().trim().min(1, "Say what this invoice is for").max(500),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const invoiceParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  invoiceId: z.string().trim().min(1).optional(),
});

export const listInvoicesQuerySchema = createListQuerySchema([
  "createdAt",
  "invoiceNumber",
  "amountTotal",
  "amountPending",
]).extend({
  status: invoiceStatusSchema.optional(),
  memberId: z.string().trim().min(1).optional(),
  membershipId: z.string().trim().min(1).optional(),
  /** The pending-fees view: everything still owed, without naming each unpaid status. */
  outstanding: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
