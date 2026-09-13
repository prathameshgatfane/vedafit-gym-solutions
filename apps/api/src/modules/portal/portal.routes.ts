import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { authenticateMember } from "../../middleware/auth.middleware";
import { portalController } from "./portal.controller";

export const portalRouter = Router();

portalRouter.use(authenticateMember);

portalRouter.get("/", asyncHandler(portalController.home));
portalRouter.get("/profile", asyncHandler(portalController.profile));
portalRouter.get("/memberships", asyncHandler(portalController.memberships));
portalRouter.get("/attendance", asyncHandler(portalController.attendance));
portalRouter.get("/payments", asyncHandler(portalController.payments));
