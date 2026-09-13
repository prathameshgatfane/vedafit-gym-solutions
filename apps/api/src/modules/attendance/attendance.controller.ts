import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import type { ListAttendanceQuery, MarkAttendanceInput } from "./attendance.schema";
import { attendanceService, type AttendanceScope } from "./attendance.service";

type OrgParams = { organizationId: string };
type AttendanceParams = OrgParams & { attendanceId: string };

/**
 * Scope comes from the verified JWT, never the URL or the body — including `branchId`, which
 * decides *where* a check-in is recorded (1.17.3), and `userId`, which records who recorded it.
 */
function scopeFrom(req: Request): AttendanceScope {
  const auth = getAuth(req);
  return {
    organizationId: auth.organizationId,
    branchId: auth.branchId,
    userId: auth.userId,
    roleId: auth.roleId,
  };
}

export const attendanceController = {
  /**
   * `201` for a new row, `200` for a repeat — the second check-in of a day is a no-op that
   * returns what is already there, not an error (1.17.2). The status code is the honest signal
   * of which happened; `alreadyCheckedIn` in the body is what the UI actually reads.
   */
  async mark(req: Request<OrgParams>, res: Response) {
    const result = await attendanceService.mark(
      scopeFrom(req),
      req.body as MarkAttendanceInput,
    );

    res.status(result.alreadyCheckedIn ? 200 : 201).json({
      success: true,
      data: result,
      message: result.alreadyCheckedIn
        ? "Already checked in today"
        : result.attendance.isOverride
          ? "Checked in as an override"
          : "Checked in",
    });
  },

  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await attendanceService.list(
      scopeFrom(req),
      req.query as unknown as ListAttendanceQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async today(req: Request<OrgParams>, res: Response) {
    const branchId = typeof req.query.branchId === "string" ? req.query.branchId : undefined;
    const summary = await attendanceService.today(scopeFrom(req), branchId);
    res.status(200).json({ success: true, data: summary });
  },

  async getById(req: Request<AttendanceParams>, res: Response) {
    const attendance = await attendanceService.getById(scopeFrom(req), req.params.attendanceId);
    res.status(200).json({ success: true, data: attendance });
  },
};
