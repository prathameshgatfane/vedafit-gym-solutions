import { z } from "zod";

/**
 * Mirrors `createInvoiceSchema` in apps/api/src/modules/invoices/invoice.schema.ts. The server
 * revalidates all of it — this exists so a typo is caught at the field rather than as a banner.
 *
 * `amountTotal` is a string because it comes from a text input: an empty box is `""`, not `NaN`,
 * and "Amount is required" beats "expected number, received nan".
 */
export const invoiceFormSchema = z.object({
  memberId: z.string().trim().min(1, "Choose a member"),
  amountTotal: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), "Enter an amount with up to 2 decimals")
    .refine((value) => Number(value) <= 99_999_999.99, "Amount is too large"),
  notes: z.string().trim().min(1, "Say what this invoice is for").max(500),
});

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;
