import { Prisma, type InvoiceStatus } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { toDecimal, ZERO } from "../../utils/money";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import type { CreateInvoiceInput, ListInvoicesQuery } from "./invoice.schema";

export interface InvoiceScope {
  organizationId: string;
  /** `null` for org-wide roles; otherwise reads are pinned to this branch via the member. */
  branchId: string | null;
}

const invoiceInclude = {
  member: { select: { id: true, firstName: true, lastName: true, phone: true } },
  membership: { select: { id: true, planId: true, startDate: true, endDate: true } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export interface InvoiceResponse {
  id: string;
  organizationId: string;
  memberId: string;
  membershipId: string | null;
  invoiceNumber: string;
  amountTotal: string;
  amountPaid: string;
  amountPending: string;
  status: InvoiceStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  member: InvoiceRow["member"];
  membership: InvoiceRow["membership"];
}

export function toInvoiceResponse(row: InvoiceRow): InvoiceResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    memberId: row.memberId,
    membershipId: row.membershipId,
    invoiceNumber: row.invoiceNumber,
    // Fixed-2 strings, per Locked Decision 1.16.2 — the client formats these, never computes on them.
    amountTotal: row.amountTotal.toFixed(2),
    amountPaid: row.amountPaid.toFixed(2),
    amountPending: row.amountPending.toFixed(2),
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    member: row.member,
    membership: row.membership,
  };
}

/**
 * Locked Decision 1.16.2 — status is a pure function of the two amounts, never set by hand
 * except for `CANCELLED`. Order matters: a zero-total invoice is `PAID` on creation, because
 * there is nothing to collect.
 */
export function deriveInvoiceStatus(
  amountTotal: Prisma.Decimal,
  amountPaid: Prisma.Decimal,
  cancelled: boolean,
): InvoiceStatus {
  if (cancelled) return "CANCELLED";
  if (amountPaid.greaterThanOrEqualTo(amountTotal)) return "PAID";
  if (amountPaid.greaterThan(ZERO)) return "PARTIALLY_PAID";
  return "UNPAID";
}

/**
 * Locked Decision 1.16.4 — allocates the next `INV-YYYY-NNNNNN` for an organization.
 *
 * The counter row is locked `FOR UPDATE` for the rest of the caller's transaction, so concurrent
 * creators serialize here and no two invoices can be handed the same number. Because the
 * increment lives in the same transaction as the insert, a failed invoice rolls its number back
 * with it and the sequence has no gaps.
 *
 * Callers that also need the organization write lock must take **that one first** — every path
 * uses the same order (organization, then sequence) so two of them can't deadlock.
 */
export async function allocateInvoiceNumber(
  tx: TransactionClient,
  organizationId: string,
  when: Date = new Date(),
): Promise<string> {
  const year = when.getUTCFullYear();

  // `INSERT IGNORE` rather than a find-then-create: the first invoice of a year would otherwise
  // race two creators into inserting the same primary key.
  await tx.$executeRaw`
    INSERT IGNORE INTO invoice_sequences (organizationId, year, nextValue, updatedAt)
    VALUES (${organizationId}, ${year}, 1, NOW(3))
  `;

  const locked = await tx.$queryRaw<{ nextValue: number }[]>`
    SELECT nextValue FROM invoice_sequences
    WHERE organizationId = ${organizationId} AND year = ${year}
    FOR UPDATE
  `;

  const nextValue = locked[0]?.nextValue ?? 1;

  await tx.$executeRaw`
    UPDATE invoice_sequences SET nextValue = ${nextValue + 1}, updatedAt = NOW(3)
    WHERE organizationId = ${organizationId} AND year = ${year}
  `;

  return `INV-${year}-${String(nextValue).padStart(6, "0")}`;
}

/**
 * Raises an invoice inside someone else's transaction. Used both by this module's `create` and
 * by the memberships module, so a sold term and its bill can never end up half-written.
 */
export async function raiseInvoice(
  tx: TransactionClient,
  input: {
    organizationId: string;
    /**
     * The branch this bill belongs to, for revenue attribution (1.18.2). Required rather than
     * derived from the member here, because the caller knows better: a membership term should be
     * attributed to the branch that *sold* it, which is immutable, and not to wherever the member
     * happens to be filed today.
     */
    branchId: string;
    memberId: string;
    membershipId?: string | null;
    amountTotal: Prisma.Decimal;
    notes?: string | null;
  },
): Promise<InvoiceRow> {
  const invoiceNumber = await allocateInvoiceNumber(tx, input.organizationId);
  const amountTotal = input.amountTotal;

  return tx.invoice.create({
    data: withGeneratedId({
      organizationId: input.organizationId,
      branchId: input.branchId,
      memberId: input.memberId,
      membershipId: input.membershipId ?? null,
      invoiceNumber,
      amountTotal,
      amountPaid: ZERO,
      amountPending: amountTotal,
      // Never DRAFT: an invoice raised here is immediately payable (1.16.2).
      status: deriveInvoiceStatus(amountTotal, ZERO, false),
      notes: input.notes ?? null,
    }),
    include: invoiceInclude,
  });
}

/**
 * Locked Decision 1.16.2 — recomputes `amountPaid`/`amountPending`/`status` by **summing the
 * payment rows**, never by adding a delta to what was already stored. An increment is correct
 * once and then silently wrong forever the first time a write half-lands; a sum is self-healing.
 *
 * `FAILED`/`PENDING` are excluded rather than `SUCCESS`/`REFUNDED` included, so a payment status
 * added by a future gateway phase does not count as money received until someone decides it does.
 */
export async function recomputeInvoiceRollup(
  tx: TransactionClient,
  invoiceId: string,
): Promise<InvoiceRow> {
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });

  const totals = await tx.payment.aggregate({
    where: { invoiceId, status: { notIn: ["FAILED", "PENDING"] } },
    _sum: { amount: true },
  });

  const amountPaid = totals._sum.amount ?? ZERO;
  const cancelled = invoice.status === "CANCELLED";

  return tx.invoice.update({
    where: { id: invoiceId },
    data: {
      amountPaid,
      amountPending: amountPendingFor(invoice.amountTotal, amountPaid, cancelled),
      status: deriveInvoiceStatus(invoice.amountTotal, amountPaid, cancelled),
    },
    include: invoiceInclude,
  });
}

/**
 * A voided bill is owed nothing. Keeping the balance on a cancelled invoice would put it on the
 * "pending fees" screen the front desk uses to chase money, and into every member's outstanding
 * total — so cancellation zeroes it. What *was* owed is still recoverable as total minus paid.
 */
export function amountPendingFor(
  amountTotal: Prisma.Decimal,
  amountPaid: Prisma.Decimal,
  cancelled: boolean,
): Prisma.Decimal {
  return cancelled ? ZERO : amountTotal.minus(amountPaid);
}

/** Branch-scoped callers see only their own branch's members' invoices — via the member.
 * Lists answer "whose bills can I collect on"; revenue aggregates use the stamped `invoice.branchId`
 * instead (Locked Decision 1.18.2). */
function branchFilter(scope: InvoiceScope): Prisma.MemberWhereInput | undefined {
  return scope.branchId ? { branchId: scope.branchId } : undefined;
}

/**
 * Loads an invoice for a write. Exported so the payments module resolves an invoice through the
 * same scope rules rather than reimplementing them.
 */
export async function findInvoiceForWrite(
  tx: TransactionClient,
  scope: InvoiceScope,
  invoiceId: string,
): Promise<InvoiceRow> {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, organizationId: scope.organizationId, member: branchFilter(scope) },
    include: invoiceInclude,
  });

  if (!invoice) {
    // Another branch's invoice reads as "not found" rather than "forbidden", so the endpoint
    // isn't an existence oracle — same rule as members and memberships.
    throw AppError.notFound(ErrorCode.INVOICE_NOT_FOUND, `Invoice "${invoiceId}" not found`);
  }

  return invoice;
}

async function lockOrganizationForWrite(tx: TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
}

async function findMemberOrThrow(tx: TransactionClient, scope: InvoiceScope, memberId: string) {
  const member = await tx.member.findFirst({
    where: {
      id: memberId,
      organizationId: scope.organizationId,
      branchId: scope.branchId ?? undefined,
      deletedAt: null,
    },
    select: { id: true, branchId: true },
  });

  if (!member) {
    throw AppError.notFound(ErrorCode.MEMBER_NOT_FOUND, `Member "${memberId}" not found`);
  }

  return member;
}

export const invoiceService = {
  async create(scope: InvoiceScope, input: CreateInvoiceInput): Promise<InvoiceResponse> {
    const invoice = await prisma.$transaction(async (tx) => {
      // Organization first, then the sequence row inside `raiseInvoice` — the lock order every
      // path uses (1.16.4).
      await lockOrganizationForWrite(tx, scope.organizationId);
      const member = await findMemberOrThrow(tx, scope, input.memberId);

      return raiseInvoice(tx, {
        organizationId: scope.organizationId,
        // An ad-hoc bill has no term to inherit a branch from, so it belongs to the branch the
        // member is filed under at the moment it is raised (1.18.2).
        branchId: member.branchId,
        memberId: member.id,
        amountTotal: toDecimal(input.amountTotal),
        notes: input.notes,
      });
    });

    return toInvoiceResponse(invoice);
  },

  async list(scope: InvoiceScope, query: ListInvoicesQuery) {
    const filtered: Prisma.InvoiceWhereInput = {
      organizationId: scope.organizationId,
      member: branchFilter(scope),
      memberId: query.memberId,
      membershipId: query.membershipId,
      status: query.status,
      // "Pending fees" is one filter rather than a status list the client has to keep in step
      // with the enum — a bill is outstanding when money is still owed on it.
      amountPending: query.outstanding ? { gt: 0 } : undefined,
      // Staff search by whichever they have in front of them: the number on a printed receipt,
      // or the member. The branch filter above still applies — this only widens *which* rows
      // match, never whose.
      OR: query.search
        ? [
            { invoiceNumber: { contains: query.search } },
            { member: { firstName: { contains: query.search } } },
            { member: { lastName: { contains: query.search } } },
            { member: { phone: { contains: query.search } } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where: filtered,
        include: invoiceInclude,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
        ...paginationSkipTake(query),
      }),
      prisma.invoice.count({ where: filtered }),
    ]);

    return {
      items: items.map(toInvoiceResponse),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  async getById(scope: InvoiceScope, invoiceId: string): Promise<InvoiceResponse> {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: scope.organizationId, member: branchFilter(scope) },
      include: invoiceInclude,
    });

    if (!invoice) {
      throw AppError.notFound(ErrorCode.INVOICE_NOT_FOUND, `Invoice "${invoiceId}" not found`);
    }

    return toInvoiceResponse(invoice);
  },

  /**
   * Locked Decision 1.16.2 — `amountTotal` is immutable, so correcting a wrong bill means
   * cancelling it and raising another. Terminal, and refused once money has been collected: a
   * paid invoice has to be refunded first, or the payment would be attached to a void bill.
   */
  async cancel(scope: InvoiceScope, invoiceId: string): Promise<InvoiceResponse> {
    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await findInvoiceForWrite(tx, scope, invoiceId);

      if (existing.status === "CANCELLED") {
        throw AppError.conflict(
          ErrorCode.INVOICE_NOT_PAYABLE,
          `Invoice ${existing.invoiceNumber} is already cancelled`,
        );
      }

      if (existing.amountPaid.greaterThan(ZERO)) {
        throw AppError.conflict(
          ErrorCode.INVOICE_NOT_PAYABLE,
          `Invoice ${existing.invoiceNumber} has ${existing.amountPaid.toFixed(2)} collected against it — refund that before cancelling`,
          { amountPaid: existing.amountPaid.toFixed(2) },
        );
      }

      return tx.invoice.update({
        where: { id: existing.id },
        data: {
          status: "CANCELLED",
          amountPending: amountPendingFor(existing.amountTotal, existing.amountPaid, true),
        },
        include: invoiceInclude,
      });
    });

    return toInvoiceResponse(invoice);
  },

  async listForMember(organizationId: string, memberId: string): Promise<InvoiceResponse[]> {
    const rows = await prisma.invoice.findMany({
      where: { organizationId, memberId },
      include: invoiceInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    return rows.map(toInvoiceResponse);
  },
};
