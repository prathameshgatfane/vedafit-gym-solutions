import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { validate } from "../../middleware/validation.middleware";
import { userController } from "./user.controller";
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userParamsSchema,
} from "./user.schema";

export const userRouter = Router({ mergeParams: true });

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
