import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import type { CreateExpenseInput, ListExpensesQuery, UpdateExpenseInput } from "./expense.schema";
import { expenseService, type ExpenseScope } from "./expense.service";

type OrgParams = { organizationId: string };
type ExpenseParams = OrgParams & { expenseId: string };

function scopeFrom(req: Request): ExpenseScope {
  const auth = getAuth(req);
  return {
    organizationId: auth.organizationId,
    branchId: auth.branchId,
    userId: auth.userId,
  };
}

export const expenseController = {
  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await expenseService.list(
      scopeFrom(req),
      req.query as unknown as ListExpensesQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<ExpenseParams>, res: Response) {
    const expense = await expenseService.getById(scopeFrom(req), req.params.expenseId);
    res.status(200).json({ success: true, data: expense });
  },

  async create(req: Request<OrgParams>, res: Response) {
    const expense = await expenseService.create(scopeFrom(req), req.body as CreateExpenseInput);
    res.status(201).json({ success: true, data: expense, message: "Expense recorded" });
  },

  async update(req: Request<ExpenseParams>, res: Response) {
    const expense = await expenseService.update(
      scopeFrom(req),
      req.params.expenseId,
      req.body as UpdateExpenseInput,
    );
    res.status(200).json({ success: true, data: expense, message: "Expense updated" });
  },

  async remove(req: Request<ExpenseParams>, res: Response) {
    await expenseService.remove(scopeFrom(req), req.params.expenseId);
    res.status(200).json({ success: true, data: null, message: "Expense deleted" });
  },
};
