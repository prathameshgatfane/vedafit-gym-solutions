import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { attendanceController } from "./attendance.controller";
import {
  attendanceParamsSchema,
  listAttendanceQuerySchema,
  markAttendanceSchema,
} from "./attendance.schema";

// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const attendanceRouter = Router({ mergeParams: true });

/**
 * No update and no delete. A check-in is a record that someone was in the building; editing one
 * would make the register a claim rather than a log, and Phase 8's numbers are built on it. A
 * wrongly-recorded visit is a data-correction job, not an endpoint.
 */
attendanceRouter.post(
  "/",
  requirePermission("attendance.mark"),
  validate(attendanceParamsSchema, "params"),
  validate(markAttendanceSchema, "body"),
  asyncHandler(attendanceController.mark),
);

attendanceRouter.get(
  "/",
  requirePermission("attendance.view"),
  validate(attendanceParamsSchema, "params"),
  validate(listAttendanceQuerySchema, "query"),
  asyncHandler(attendanceController.list),
);

/** Ahead of `/:attendanceId`, or "today" would be read as an id. */
attendanceRouter.get(
  "/today",
  requirePermission("attendance.view"),
  validate(attendanceParamsSchema, "params"),
  asyncHandler(attendanceController.today),
);

attendanceRouter.get(
  "/:attendanceId",
  requirePermission("attendance.view"),
  validate(attendanceParamsSchema, "params"),
  asyncHandler(attendanceController.getById),
);
