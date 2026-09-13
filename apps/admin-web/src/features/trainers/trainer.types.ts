import type { ListParams } from "../../lib/url-list-params";

/** Mirrors `TrainerProfileResponse` in apps/api/src/modules/trainers/trainer.service.ts. */
export interface TrainerAssignment {
  id: string;
  memberId: string;
  assignedAt: string;
  member: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    status: string;
    branchId: string;
  };
}

export interface TrainerProfile {
  id: string;
  organizationId: string;
  userId: string;
  specialization: string | null;
  /** Fixed-2 decimal string, or null when no rate is on file. Never a float. */
  commissionPct: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    status: string;
    branchId: string | null;
  };
  assignments: TrainerAssignment[];
}

/** A staff member who can still receive a profile (1.19.3). */
export interface TrainerCandidate {
  id: string;
  name: string;
  email: string;
  branchId: string | null;
  roleName: string;
}

export type TrainerSortField = "name" | "createdAt";

export type TrainerListParams = ListParams<TrainerSortField, never>;

export const DEFAULT_TRAINER_LIST_PARAMS: TrainerListParams = {
  page: 1,
  limit: 10,
  search: "",
  status: "",
  sortBy: "name",
  sortOrder: "asc",
};
