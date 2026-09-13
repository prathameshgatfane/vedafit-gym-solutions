import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { authenticate } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { tenantScope } from "../../middleware/tenant.middleware";
import { validate } from "../../middleware/validation.middleware";
import { organizationController } from "./organization.controller";
import { organizationIdParamsSchema, updateOrganizationSchema } from "./organization.schema";
import { branchRouter } from "../branches/branch.routes";
import { userRouter } from "../users/user.routes";
import { roleRouter } from "../roles/role.routes";
import { memberRouter } from "../members/member.routes";
import { membershipPlanRouter } from "../membership-plans/membership-plan.routes";
import { membershipRouter } from "../memberships/membership.routes";
import { invoiceRouter } from "../invoices/invoice.routes";
import { paymentRouter } from "../payments/payment.routes";
import { attendanceRouter } from "../attendance/attendance.routes";
import { reportRouter } from "../reports/report.routes";
import { trainerRouter } from "../trainers/trainer.routes";
import { leadRouter } from "../leads/lead.routes";
import { expenseRouter } from "../expenses/expense.routes";
import { notificationRouter } from "../notifications/notification.routes";

export const organizationRouter = Router();

// Nothing under /organizations is reachable without a valid access token.
organizationRouter.use(authenticate);

/**
 * One guard covering every org-scoped path below, including the nested routers, because this
 * `use()` prefix-matches `/:organizationId/anything`. The URL's organizationId is a
 * client-supplied claim like any other, so it is checked against the JWT before a handler runs —
 * this is what makes org A's token useless against org B on every module at once (Section 6).
 */
organizationRouter.use("/:organizationId", tenantScope);

/**
 * Note: there is deliberately no `POST /organizations` or `GET /organizations` (list-all).
 * Organizations are created by `provisionOrganization` (signup / Super Admin), not this router.
 * Tenant PATCH may update contact fields; `status` is platform-only (15.7).
 * See Section 9 (2026-09-06 and 2026-09-13).
 */
organizationRouter.get(
  "/:organizationId",
  validate(organizationIdParamsSchema, "params"),
  asyncHandler(organizationController.getById),
);

organizationRouter.patch(
  "/:organizationId",
  requirePermission("organizations.update"),
  validate(organizationIdParamsSchema, "params"),
  validate(updateOrganizationSchema, "body"),
  asyncHandler(organizationController.update),
);

organizationRouter.use("/:organizationId/branches", branchRouter);
organizationRouter.use("/:organizationId/users", userRouter);
organizationRouter.use("/:organizationId/roles", roleRouter);
organizationRouter.use("/:organizationId/members", memberRouter);
organizationRouter.use("/:organizationId/membership-plans", membershipPlanRouter);
organizationRouter.use("/:organizationId/memberships", membershipRouter);
organizationRouter.use("/:organizationId/invoices", invoiceRouter);
organizationRouter.use("/:organizationId/payments", paymentRouter);
organizationRouter.use("/:organizationId/attendance", attendanceRouter);
organizationRouter.use("/:organizationId/reports", reportRouter);
organizationRouter.use("/:organizationId/trainers", trainerRouter);
organizationRouter.use("/:organizationId/leads", leadRouter);
organizationRouter.use("/:organizationId/expenses", expenseRouter);
organizationRouter.use("/:organizationId/notifications", notificationRouter);
