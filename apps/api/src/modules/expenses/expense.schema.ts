import { z } from "zod";
import { moneyAmountSchema } from "../../utils/money";
import { createListQuerySchema } from "../../utils/pagination";

export const expenseCategorySchema = z.enum([
  "RENT",
  "UTILITIES",
  "SALARIES",
  "EQUIPMENT",
  "MARKETING",
  "SOFTWARE",
  "MAINTENANCE",
  "SUPPLIES",
  "PROFESSIONAL_FEES",
  "OTHER",
]);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

const calendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Not a real date");

const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal(""), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === "" || value === null) return null;
      return value;
    });

export const createExpenseSchema = z.object({
  category: expenseCategorySchema,
  amount: moneyAmountSchema("Amount", { positive: true }),
  expenseDate: calendarDateSchema,
  branchId: z.union([z.string().trim().min(1), z.null()]).optional(),
  paidTo: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z
  .object({
    category: expenseCategorySchema.optional(),
    amount: moneyAmountSchema("Amount", { positive: true }).optional(),
    expenseDate: calendarDateSchema.optional(),
    branchId: z.union([z.string().trim().min(1), z.null()]).optional(),
    paidTo: optionalText(120),
    notes: optionalText(500),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const expenseParamsSchema = z.object({
  organizationId: z.string().trim().min(1),
  expenseId: z.string().trim().min(1).optional(),
});

export const listExpensesQuerySchema = createListQuerySchema([
  "expenseDate",
  "amount",
  "createdAt",
]).extend({
  category: expenseCategorySchema.optional(),
  branchId: z.string().trim().min(1).optional(),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
