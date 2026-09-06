import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { requirePermission } from "../../middleware/permission.middleware";
import { validate } from "../../middleware/validation.middleware";
import { userController } from "./user.controller";
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userParamsSchema,
} from "./user.schema";

// `authenticate` and `tenantScope` are already applied by the parent organizationRouter.
export const userRouter = Router({ mergeParams: true });

/**
 * Staff administration is gated on `users.manage` end to end — reads included. Per the Section 4.2
 * matrix that means OWNER and ADMIN only; MANAGER, RECEPTIONIST, TRAINER and ACCOUNTANT are all
 * refused, since the staff list exposes colleagues' contact details and role assignments.
 */
userRouter.use(requirePermission("users.manage"));

userRouter.post(
  "/",
  validate(userParamsSchema, "params"),
  validate(createUserSchema, "body"),
  asyncHandler(userController.create),
);

userRouter.get(
  "/",
  validate(userParamsSchema, "params"),
  validate(listUsersQuerySchema, "query"),
  asyncHandler(userController.list),
);

userRouter.get(
  "/:userId",
  validate(userParamsSchema, "params"),
  asyncHandler(userController.getById),
);

userRouter.patch(
  "/:userId",
  validate(userParamsSchema, "params"),
  validate(updateUserSchema, "body"),
  asyncHandler(userController.update),
);

userRouter.delete(
  "/:userId",
  validate(userParamsSchema, "params"),
  asyncHandler(userController.remove),
);
