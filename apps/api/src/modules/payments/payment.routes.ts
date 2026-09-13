import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { paymentController } from "./payment.controller";
import {
  createPaymentSchema,
  listPaymentsQuerySchema,
  paymentParamsSchema,
  refundPaymentSchema,
} from "./payment.schema";

// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const paymentRouter = Router({ mergeParams: true });

/**
 * No update and no delete. Payments are append-only (Locked Decision 1.4): a correction is a
 * refund, which is its own row with its own permission and its own audit entry. A PATCH here
 * would be the one hole that makes the audit log unreliable.
 */
paymentRouter.post(
  "/",
  requirePermission("payments.create"),
  validate(paymentParamsSchema, "params"),
  validate(createPaymentSchema, "body"),
  asyncHandler(paymentController.create),
);

paymentRouter.get(
  "/",
  requirePermission("payments.view"),
  validate(paymentParamsSchema, "params"),
  validate(listPaymentsQuerySchema, "query"),
  asyncHandler(paymentController.list),
);

paymentRouter.get(
  "/:paymentId",
  requirePermission("payments.view"),
  validate(paymentParamsSchema, "params"),
  asyncHandler(paymentController.getById),
);

/**
 * `payments.refund` and nothing else — this is the permission the Section 4.2 matrix is most
 * careful about, and Locked Decision 1.16.1 keeps every money-returning path behind it rather
 * than letting a plan change or an overpayment reach it sideways.
 */
paymentRouter.post(
  "/:paymentId/refund",
  requirePermission("payments.refund"),
  validate(paymentParamsSchema, "params"),
  validate(refundPaymentSchema, "body"),
  asyncHandler(paymentController.refund),
);
