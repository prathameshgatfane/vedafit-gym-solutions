import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { expenseController } from "./expense.controller";
import {
  createExpenseSchema,
  expenseParamsSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
} from "./expense.schema";

export const expenseRouter = Router({ mergeParams: true });

expenseRouter.use(requirePermission("expenses.manage"));

expenseRouter.get(
  "/",
  validate(expenseParamsSchema, "params"),
  validate(listExpensesQuerySchema, "query"),
  asyncHandler(expenseController.list),
);

expenseRouter.post(
  "/",
  validate(expenseParamsSchema, "params"),
  validate(createExpenseSchema, "body"),
  asyncHandler(expenseController.create),
);

expenseRouter.get(
  "/:expenseId",
  validate(expenseParamsSchema, "params"),
  asyncHandler(expenseController.getById),
);

expenseRouter.patch(
  "/:expenseId",
  validate(expenseParamsSchema, "params"),
  validate(updateExpenseSchema, "body"),
  asyncHandler(expenseController.update),
);

expenseRouter.delete(
  "/:expenseId",
  validate(expenseParamsSchema, "params"),
  asyncHandler(expenseController.remove),
);
