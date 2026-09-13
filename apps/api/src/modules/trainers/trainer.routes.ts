import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { trainerController } from "./trainer.controller";
import {
  assignMemberSchema,
  createTrainerProfileSchema,
  listTrainersQuerySchema,
  trainerParamsSchema,
  updateTrainerProfileSchema,
} from "./trainer.schema";

// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const trainerRouter = Router({ mergeParams: true });

trainerRouter.use(requirePermission("trainers.manage"));

trainerRouter.get(
  "/candidates",
  validate(trainerParamsSchema, "params"),
  asyncHandler(trainerController.candidates),
);

trainerRouter.get(
  "/",
  validate(trainerParamsSchema, "params"),
  validate(listTrainersQuerySchema, "query"),
  asyncHandler(trainerController.list),
);

trainerRouter.post(
  "/",
  validate(trainerParamsSchema, "params"),
  validate(createTrainerProfileSchema, "body"),
  asyncHandler(trainerController.create),
);

trainerRouter.get(
  "/:trainerId",
  validate(trainerParamsSchema, "params"),
  asyncHandler(trainerController.getById),
);

trainerRouter.patch(
  "/:trainerId",
  validate(trainerParamsSchema, "params"),
  validate(updateTrainerProfileSchema, "body"),
  asyncHandler(trainerController.update),
);

trainerRouter.post(
  "/:trainerId/members",
  validate(trainerParamsSchema, "params"),
  validate(assignMemberSchema, "body"),
  asyncHandler(trainerController.assignMember),
);

trainerRouter.delete(
  "/:trainerId/members/:memberId",
  validate(trainerParamsSchema, "params"),
  asyncHandler(trainerController.unassignMember),
);
