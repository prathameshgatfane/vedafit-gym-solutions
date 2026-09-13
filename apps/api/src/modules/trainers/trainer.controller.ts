import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import type {
  AssignMemberInput,
  CreateTrainerProfileInput,
  ListTrainersQuery,
  UpdateTrainerProfileInput,
} from "./trainer.schema";
import { trainerService, type TrainerScope } from "./trainer.service";

type OrgParams = { organizationId: string };
type TrainerParams = OrgParams & { trainerId: string };
type AssignmentParams = TrainerParams & { memberId: string };

function scopeFrom(req: Request): TrainerScope {
  const auth = getAuth(req);
  return {
    organizationId: auth.organizationId,
    branchId: auth.branchId,
    userId: auth.userId,
  };
}

export const trainerController = {
  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await trainerService.list(
      scopeFrom(req),
      req.query as unknown as ListTrainersQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async candidates(req: Request<OrgParams>, res: Response) {
    const data = await trainerService.candidates(scopeFrom(req));
    res.status(200).json({ success: true, data });
  },

  async getById(req: Request<TrainerParams>, res: Response) {
    const trainer = await trainerService.getById(scopeFrom(req), req.params.trainerId);
    res.status(200).json({ success: true, data: trainer });
  },

  async create(req: Request<OrgParams>, res: Response) {
    const trainer = await trainerService.create(
      scopeFrom(req),
      req.body as CreateTrainerProfileInput,
    );
    res.status(201).json({ success: true, data: trainer, message: "Trainer profile created" });
  },

  async update(req: Request<TrainerParams>, res: Response) {
    const trainer = await trainerService.update(
      scopeFrom(req),
      req.params.trainerId,
      req.body as UpdateTrainerProfileInput,
    );
    res.status(200).json({ success: true, data: trainer, message: "Trainer profile updated" });
  },

  async assignMember(req: Request<TrainerParams>, res: Response) {
    const trainer = await trainerService.assignMember(
      scopeFrom(req),
      req.params.trainerId,
      req.body as AssignMemberInput,
    );
    res.status(200).json({ success: true, data: trainer, message: "Member assigned" });
  },

  async unassignMember(req: Request<AssignmentParams>, res: Response) {
    const trainer = await trainerService.unassignMember(
      scopeFrom(req),
      req.params.trainerId,
      req.params.memberId,
    );
    res.status(200).json({ success: true, data: trainer, message: "Member unassigned" });
  },
};
