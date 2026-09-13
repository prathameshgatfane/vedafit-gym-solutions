import { Prisma, type LeadStatus } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import { createMemberInTransaction } from "../members/member.service";
import { SAAS_ENTITLEMENT_KEY } from "../saas/saas-catalog";
import { assertEntitlement } from "../saas/saas-entitlements.service";
import type {
  ConvertLeadInput,
  CreateLeadInput,
  ListLeadsQuery,
  UpdateLeadInput,
} from "./lead.schema";

export interface LeadScope {
  organizationId: string;
  branchId: string | null;
  userId: string;
}

const OPEN_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "TRIAL_SCHEDULED"];

/**
 * Locked Decision 1.20.1. CONVERTED is absent as a PATCH target — convert is its own endpoint.
 */
const ALLOWED_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ["CONTACTED", "TRIAL_SCHEDULED", "LOST"],
  CONTACTED: ["TRIAL_SCHEDULED", "LOST"],
  TRIAL_SCHEDULED: ["LOST"],
  LOST: ["CONTACTED"],
  CONVERTED: [],
};

function assertTransition(from: LeadStatus, to: LeadStatus): void {
  if (from === to) return;
  if (ALLOWED_TRANSITIONS[from].includes(to)) return;
  throw new AppError(
    409,
    ErrorCode.INVALID_LEAD_TRANSITION,
    `Cannot move a ${from} lead to ${to}`,
    { from, to, allowed: ALLOWED_TRANSITIONS[from] },
  );
}

const leadInclude = {
  assignedTo: { select: { id: true, name: true, email: true } },
  branch: { select: { id: true, name: true } },
  convertedMember: {
    select: { id: true, firstName: true, lastName: true, phone: true, status: true },
  },
} satisfies Prisma.LeadInclude;

type LeadRow = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

export interface LeadResponse {
  id: string;
  organizationId: string;
  branchId: string | null;
  name: string;
  phone: string;
  source: string | null;
  status: LeadStatus;
  assignedToUserId: string | null;
  followUpAt: Date | null;
  convertedMemberId: string | null;
  createdAt: Date;
  updatedAt: Date;
  allowedTransitions: LeadStatus[];
  assignedTo: LeadRow["assignedTo"];
  branch: LeadRow["branch"];
  convertedMember: LeadRow["convertedMember"];
}

function toResponse(row: LeadRow): LeadResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    branchId: row.branchId,
    name: row.name,
    phone: row.phone,
    source: row.source,
    status: row.status,
    assignedToUserId: row.assignedToUserId,
    followUpAt: row.followUpAt,
    convertedMemberId: row.convertedMemberId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    allowedTransitions: [...ALLOWED_TRANSITIONS[row.status]],
    assignedTo: row.assignedTo,
    branch: row.branch,
    convertedMember: row.convertedMember,
  };
}

function resolveBranchFilter(scope: LeadScope, requested?: string): string | undefined {
  return scope.branchId ?? requested;
}

async function lockOrganization(tx: TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
}

async function assertOpenPhoneIsFree(
  tx: TransactionClient,
  organizationId: string,
  phone: string,
  excludeLeadId?: string,
) {
  const existing = await tx.lead.findFirst({
    where: {
      organizationId,
      phone,
      status: { in: OPEN_STATUSES },
      id: excludeLeadId ? { not: excludeLeadId } : undefined,
    },
    select: { id: true, name: true, status: true },
  });
  if (existing) {
    throw AppError.conflict(
      ErrorCode.DUPLICATE_OPEN_LEAD,
      `An open lead for ${phone} already exists (${existing.name}, ${existing.status})`,
      { conflictingLeadId: existing.id },
    );
  }
}

async function assertBranchInOrg(
  tx: TransactionClient,
  organizationId: string,
  branchId: string,
) {
  const branch = await tx.branch.findFirst({
    where: { id: branchId, organizationId },
    select: { id: true },
  });
  if (!branch) {
    throw AppError.notFound(ErrorCode.BRANCH_NOT_FOUND, `Branch "${branchId}" not found`);
  }
}

async function permissionKeysFor(roleId: string): Promise<Set<string>> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  return new Set(rows.map((row) => row.permission.key));
}

async function assertEligibleAssignee(
  organizationId: string,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true, name: true, status: true, deletedAt: true, roleId: true },
  });
  if (!user || user.deletedAt) {
    throw AppError.notFound(ErrorCode.USER_NOT_FOUND, `User "${userId}" not found`);
  }
  if (user.status !== "ACTIVE") {
    throw AppError.conflict(
      ErrorCode.USER_NOT_ELIGIBLE_ASSIGNEE,
      `${user.name} is not an active staff member`,
    );
  }
  const keys = await permissionKeysFor(user.roleId);
  if (!keys.has("leads.manage")) {
    throw AppError.conflict(
      ErrorCode.USER_NOT_ELIGIBLE_ASSIGNEE,
      `${user.name} cannot be assigned a lead — their role does not run the pipeline`,
    );
  }
}

async function findLeadOrThrow(scope: LeadScope, leadId: string): Promise<LeadRow> {
  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      organizationId: scope.organizationId,
      branchId: scope.branchId ?? undefined,
    },
    include: leadInclude,
  });
  if (!lead) {
    throw AppError.notFound(ErrorCode.LEAD_NOT_FOUND, `Lead "${leadId}" not found`);
  }
  return lead;
}

function stampBranchId(scope: LeadScope, requested?: string | null): string | null {
  if (scope.branchId) return scope.branchId;
  if (requested === undefined) return null;
  return requested;
}

export const leadService = {
  async list(scope: LeadScope, query: ListLeadsQuery) {
    const search = query.search?.trim();
    const where: Prisma.LeadWhereInput = {
      organizationId: scope.organizationId,
      branchId: resolveBranchFilter(scope, query.branchId),
      status: query.status,
      assignedToUserId: query.assignedToUserId,
      OR: search
        ? [{ name: { contains: search } }, { phone: { contains: search } }]
        : undefined,
    };

    const orderBy: Prisma.LeadOrderByWithRelationInput =
      query.sortBy === "followUpAt"
        ? { followUpAt: query.sortOrder }
        : query.sortBy === "name"
          ? { name: query.sortOrder }
          : { createdAt: query.sortOrder };

    const [rows, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: leadInclude,
        orderBy,
        ...paginationSkipTake(query),
      }),
      prisma.lead.count({ where }),
    ]);

    return {
      items: rows.map(toResponse),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  async getById(scope: LeadScope, leadId: string): Promise<LeadResponse> {
    return toResponse(await findLeadOrThrow(scope, leadId));
  },

  /**
   * Staff a manager/receptionist can assign a lead to, without holding `users.manage` (1.20.3).
   */
  async assignees(scope: LeadScope) {
    const users = await prisma.user.findMany({
      where: {
        organizationId: scope.organizationId,
        deletedAt: null,
        status: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        email: true,
        branchId: true,
        roleId: true,
      },
      orderBy: { name: "asc" },
    });

    const eligible: { id: string; name: string; email: string; branchId: string | null }[] = [];
    for (const user of users) {
      const keys = await permissionKeysFor(user.roleId);
      if (keys.has("leads.manage")) {
        eligible.push({
          id: user.id,
          name: user.name,
          email: user.email,
          branchId: user.branchId,
        });
      }
    }
    return eligible;
  },

  async create(scope: LeadScope, input: CreateLeadInput): Promise<LeadResponse> {
    const branchId = stampBranchId(scope, input.branchId);

    const created = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, scope.organizationId);
      await assertEntitlement(scope.organizationId, SAAS_ENTITLEMENT_KEY.LEADS, { db: tx });
      if (branchId) await assertBranchInOrg(tx, scope.organizationId, branchId);
      if (input.assignedToUserId) {
        await assertEligibleAssignee(scope.organizationId, input.assignedToUserId);
      }
      await assertOpenPhoneIsFree(tx, scope.organizationId, input.phone);

      return tx.lead.create({
        data: withGeneratedId({
          organizationId: scope.organizationId,
          branchId,
          name: input.name.trim(),
          phone: input.phone,
          source: input.source?.trim() ? input.source.trim() : null,
          assignedToUserId: input.assignedToUserId ?? null,
          followUpAt: input.followUpAt ? new Date(input.followUpAt) : null,
        }),
        include: leadInclude,
      });
    });

    return toResponse(created);
  },

  async update(scope: LeadScope, leadId: string, input: UpdateLeadInput): Promise<LeadResponse> {
    // Scope 404 happens before the lock so a branch-scoped caller never learns that the row
    // exists elsewhere. Status and phone uniqueness are re-checked after the org lock so a
    // concurrent convert cannot be overwritten (same shape as 1.3).
    await findLeadOrThrow(scope, leadId);

    let nextBranchId: string | null | undefined = input.branchId;
    if (scope.branchId) {
      if (input.branchId && input.branchId !== scope.branchId) {
        throw AppError.notFound(ErrorCode.LEAD_NOT_FOUND, `Lead "${leadId}" not found`);
      }
      nextBranchId = undefined;
    }

    const updated = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, scope.organizationId);
      const current = await tx.lead.findUnique({ where: { id: leadId } });
      if (!current) {
        throw AppError.notFound(ErrorCode.LEAD_NOT_FOUND, `Lead "${leadId}" not found`);
      }
      if (current.status === "CONVERTED") {
        throw AppError.conflict(
          ErrorCode.LEAD_CONVERTED,
          "A converted lead is history — edit the member instead",
        );
      }
      if (input.status) assertTransition(current.status, input.status);
      if (nextBranchId) await assertBranchInOrg(tx, scope.organizationId, nextBranchId);
      if (input.assignedToUserId) {
        await assertEligibleAssignee(scope.organizationId, input.assignedToUserId);
      }
      const phone = input.phone ?? current.phone;
      await assertOpenPhoneIsFree(tx, scope.organizationId, phone, current.id);

      const data: Prisma.LeadUncheckedUpdateInput = {};
      if (input.name !== undefined) data.name = input.name.trim();
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.source !== undefined) data.source = input.source;
      if (nextBranchId !== undefined) data.branchId = nextBranchId;
      if (input.assignedToUserId !== undefined) data.assignedToUserId = input.assignedToUserId;
      if (input.followUpAt !== undefined) {
        data.followUpAt = input.followUpAt === null ? null : new Date(input.followUpAt);
      }
      if (input.status !== undefined) data.status = input.status;

      return tx.lead.update({
        where: { id: leadId },
        data,
        include: leadInclude,
      });
    });

    return toResponse(updated);
  },

  async convert(
    scope: LeadScope,
    leadId: string,
    input: ConvertLeadInput,
  ): Promise<LeadResponse> {
    await findLeadOrThrow(scope, leadId);

    const converted = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, scope.organizationId);
      const current = await tx.lead.findUnique({ where: { id: leadId } });
      if (!current) {
        throw AppError.notFound(ErrorCode.LEAD_NOT_FOUND, `Lead "${leadId}" not found`);
      }
      if (current.status === "CONVERTED") {
        throw AppError.conflict(
          ErrorCode.LEAD_CONVERTED,
          "This lead has already been converted",
          { memberId: current.convertedMemberId },
        );
      }
      if (current.status === "LOST") {
        throw AppError.conflict(
          ErrorCode.LEAD_NOT_CONVERTIBLE,
          "Reopen a lost lead to CONTACTED before converting",
        );
      }

      const branchId = scope.branchId ?? input.branchId;
      if (!branchId) {
        throw AppError.badRequest(
          ErrorCode.BRANCH_NOT_FOUND,
          "A member needs a home branch — pick one to convert",
        );
      }

      const member = await createMemberInTransaction(tx, scope.organizationId, {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: current.phone,
        branchId,
        email: input.email,
        dateOfBirth: input.dateOfBirth,
      });

      return tx.lead.update({
        where: { id: leadId },
        data: { status: "CONVERTED", convertedMemberId: member.id },
        include: leadInclude,
      });
    });

    return toResponse(converted);
  },
};
