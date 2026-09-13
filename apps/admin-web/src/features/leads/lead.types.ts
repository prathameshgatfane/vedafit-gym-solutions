import type { ListParams } from "../../lib/url-list-params";

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "TRIAL_SCHEDULED",
  "CONVERTED",
  "LOST",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadPerson {
  id: string;
  name: string;
  email: string;
}

export interface LeadBranch {
  id: string;
  name: string;
}

export interface ConvertedMember {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  status: string;
}

/** Mirrors `LeadResponse` in apps/api/src/modules/leads/lead.service.ts. */
export interface Lead {
  id: string;
  organizationId: string;
  branchId: string | null;
  name: string;
  phone: string;
  source: string | null;
  status: LeadStatus;
  assignedToUserId: string | null;
  followUpAt: string | null;
  convertedMemberId: string | null;
  createdAt: string;
  updatedAt: string;
  allowedTransitions: LeadStatus[];
  assignedTo: LeadPerson | null;
  branch: LeadBranch | null;
  convertedMember: ConvertedMember | null;
}

export interface LeadAssignee {
  id: string;
  name: string;
  email: string;
  branchId: string | null;
}

export type LeadSortField = "createdAt" | "followUpAt" | "name";

export type LeadListParams = ListParams<LeadSortField, LeadStatus> & {
  assignedToUserId: string;
};

export const DEFAULT_LEAD_LIST_PARAMS: LeadListParams = {
  page: 1,
  limit: 10,
  search: "",
  status: "",
  sortBy: "createdAt",
  sortOrder: "desc",
  assignedToUserId: "",
};

export const TRANSITION_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  TRIAL_SCHEDULED: "Trial scheduled",
  CONVERTED: "Converted",
  LOST: "Lost",
};
