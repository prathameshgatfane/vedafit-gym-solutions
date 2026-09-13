import { z } from "zod";
import { EXPENSE_CATEGORIES } from "./expense.types";

export const expenseFormSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, { required_error: "Pick a category" }),
  amount: z
    .string()
    .trim()
    .min(1, "Amount is required")
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), "Enter an amount with up to 2 decimals")
    .refine((value) => Number(value) > 0, "Amount must be greater than zero")
    .refine((value) => Number(value) <= 99_999_999.99, "Amount is too large"),
  expenseDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  branchId: z.string(),
  paidTo: z.string().trim().max(120),
  notes: z.string().trim().max(500),
});

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;
