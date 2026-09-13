import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { invoiceController } from "./invoice.controller";
import {
  createInvoiceSchema,
  invoiceParamsSchema,
  listInvoicesQuerySchema,
} from "./invoice.schema";

// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const invoiceRouter = Router({ mergeParams: true });

/**
 * There is no update route. `amountTotal` is immutable (Locked Decision 1.16.2), the paid/pending
 * columns are a rollup of the payment rows and are never written by hand, and `status` is derived
 * from them — which leaves nothing a PATCH could legitimately change. Correcting a bill is
 * cancel-and-reissue, and that is the one status a human sets.
 */
invoiceRouter.post(
  "/",
  requirePermission("invoices.manage"),
  validate(invoiceParamsSchema, "params"),
  validate(createInvoiceSchema, "body"),
  asyncHandler(invoiceController.create),
);

invoiceRouter.get(
  "/",
  requirePermission("invoices.view"),
  validate(invoiceParamsSchema, "params"),
  validate(listInvoicesQuerySchema, "query"),
  asyncHandler(invoiceController.list),
);

invoiceRouter.get(
  "/:invoiceId",
  requirePermission("invoices.view"),
  validate(invoiceParamsSchema, "params"),
  asyncHandler(invoiceController.getById),
);

invoiceRouter.post(
  "/:invoiceId/cancel",
  requirePermission("invoices.manage"),
  validate(invoiceParamsSchema, "params"),
  asyncHandler(invoiceController.cancel),
);
