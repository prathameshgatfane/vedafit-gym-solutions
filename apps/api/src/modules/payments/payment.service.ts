import { Prisma, type PaymentMethod, type PaymentStatus } from "@prisma/client";
import { AppError } from "../../lib/app-error";
import { ErrorCode } from "../../lib/error-codes";
import { prisma, withGeneratedId, type TransactionClient } from "../../lib/prisma";
import { toDecimal, ZERO } from "../../utils/money";
import { buildPaginationMeta, paginationSkipTake } from "../../utils/pagination";
import {
  findInvoiceForWrite,
  recomputeInvoiceRollup,
  toInvoiceResponse,
  type InvoiceResponse,
} from "../invoices/invoice.service";
import type { CreatePaymentInput, ListPaymentsQuery, RefundPaymentInput } from "./payment.schema";

export interface PaymentScope {
  organizationId: string;
  branchId: string | null;
  /** Whoever is signed in — recorded as the actor on a refund's audit entry. */
  userId: string;
}

const paymentInclude = {
  member: { select: { id: true, firstName: true, lastName: true, phone: true } },
  invoice: { select: { id: true, invoiceNumber: true, amountTotal: true, status: true } },
} satisfies Prisma.PaymentInclude;

type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export interface PaymentResponse {
  id: string;
  organizationId: string;
  memberId: string;
  membershipId: string | null;
  invoiceId: string | null;
  /** Negative on a refund row (Locked Decision 1.16.3). Fixed-2 string, never a float. */
  amount: string;
  method: PaymentMethod;
  status: PaymentStatus;
  refundOfPaymentId: string | null;
  /** True when this row reverses another one — the sign and the link, stated once for the client. */
  isRefund: boolean;
  paidAt: Date;
  createdAt: Date;
  member: PaymentRow["member"];
  invoice: { id: string; invoiceNumber: string; amountTotal: string; status: string } | null;
}

export function toPaymentResponse(row: PaymentRow): PaymentResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    memberId: row.memberId,
    membershipId: row.membershipId,
    invoiceId: row.invoiceId,
    amount: row.amount.toFixed(2),
    method: row.method,
    status: row.status,
    refundOfPaymentId: row.refundOfPaymentId,
    isRefund: row.refundOfPaymentId !== null,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    member: row.member,
    invoice: row.invoice
      ? {
          id: row.invoice.id,
          invoiceNumber: row.invoice.invoiceNumber,
          amountTotal: row.invoice.amountTotal.toFixed(2),
          status: row.invoice.status,
        }
      : null,
  };
}

async function lockOrganizationForWrite(tx: TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
}

/** Branch-scoped callers see only their own branch's members' payments — via the member.
 * The ledger is a collection worklist; monthly revenue uses the stamped `payment.branchId`
 * (Locked Decision 1.18.2). */
function branchFilter(scope: PaymentScope): Prisma.MemberWhereInput | undefined {
  return scope.branchId ? { branchId: scope.branchId } : undefined;
}

async function findPaymentForWrite(
  tx: TransactionClient,
  scope: PaymentScope,
  paymentId: string,
): Promise<PaymentRow> {
  const payment = await tx.payment.findFirst({
    where: { id: paymentId, organizationId: scope.organizationId, member: branchFilter(scope) },
    include: paymentInclude,
  });

  if (!payment) {
    throw AppError.notFound(ErrorCode.PAYMENT_NOT_FOUND, `Payment "${paymentId}" not found`);
  }

  return payment;
}

/** How much of this payment has already been given back, as a positive number. */
async function refundedSoFar(tx: TransactionClient, paymentId: string): Promise<Prisma.Decimal> {
  const totals = await tx.payment.aggregate({
    where: { refundOfPaymentId: paymentId },
    _sum: { amount: true },
  });

  // Refund rows are stored negative, so the sum is negative or absent.
  return (totals._sum.amount ?? ZERO).negated();
}

export const paymentService = {
  /**
   * Records money received against an invoice, then recomputes that invoice from its payment
   * rows (Locked Decision 1.16.2). Both happen in one transaction, so an invoice can never
   * disagree with the payments underneath it.
   */
  async create(
    scope: PaymentScope,
    input: CreatePaymentInput,
  ): Promise<{ payment: PaymentResponse; invoice: InvoiceResponse }> {
    const result = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, scope.organizationId);

      const invoice = await findInvoiceForWrite(tx, scope, input.invoiceId);

      if (invoice.status === "CANCELLED") {
        throw AppError.conflict(
          ErrorCode.INVOICE_NOT_PAYABLE,
          `Invoice ${invoice.invoiceNumber} was cancelled and takes no further payments`,
        );
      }

      const amount = toDecimal(input.amount);

      // Locked Decision 1.16.2 — overpayment is refused rather than credited forward or
      // auto-refunded, and the error says what is actually outstanding, because the overwhelming
      // cause is a slipped digit at the counter.
      if (amount.greaterThan(invoice.amountPending)) {
        throw AppError.conflict(
          ErrorCode.PAYMENT_EXCEEDS_INVOICE,
          `Invoice ${invoice.invoiceNumber} has ${invoice.amountPending.toFixed(2)} outstanding — ${amount.toFixed(2)} is more than that`,
          {
            amountPending: invoice.amountPending.toFixed(2),
            amountOffered: amount.toFixed(2),
          },
        );
      }

      const payment = await tx.payment.create({
        data: withGeneratedId({
          organizationId: scope.organizationId,
          // Copied from the invoice rather than accepted from the client: the bill already knows
          // who owes it, for what, and which branch it belongs to (1.18.2). Taking the branch
          // from the invoice rather than the caller also means a payment can never be attributed
          // somewhere its own invoice isn't.
          branchId: invoice.branchId,
          memberId: invoice.memberId,
          membershipId: invoice.membershipId,
          invoiceId: invoice.id,
          amount,
          method: input.method,
          status: "SUCCESS",
        }),
        include: paymentInclude,
      });

      const updatedInvoice = await recomputeInvoiceRollup(tx, invoice.id);

      return { payment, invoice: updatedInvoice };
    });

    return {
      payment: toPaymentResponse(result.payment),
      invoice: toInvoiceResponse(result.invoice),
    };
  },

  /**
   * Locked Decision 1.16.3 — a refund is a **new row** with a negative amount pointing at the
   * payment it reverses. The original is never updated and never deleted; it keeps
   * `status = SUCCESS`, because it did succeed, and rewriting that would destroy the fact an
   * audit trail exists to preserve.
   *
   * The parent invoice needs no special case: the negative row is part of the same `SUM`, so the
   * rollup falls out and a fully refunded `PAID` invoice returns to `UNPAID` by itself.
   */
  async refund(
    scope: PaymentScope,
    paymentId: string,
    input: RefundPaymentInput,
  ): Promise<{ refund: PaymentResponse; original: PaymentResponse; invoice: InvoiceResponse | null }> {
    const result = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, scope.organizationId);

      const original = await findPaymentForWrite(tx, scope, paymentId);

      if (original.refundOfPaymentId !== null) {
        throw AppError.conflict(
          ErrorCode.INVALID_REFUND_TARGET,
          "That row is itself a refund — reversing a refund is a new payment, not a refund",
        );
      }

      if (original.status !== "SUCCESS") {
        throw AppError.conflict(
          ErrorCode.INVALID_REFUND_TARGET,
          `Only a successful payment can be refunded (this one is ${original.status})`,
          { status: original.status },
        );
      }

      const amount = toDecimal(input.amount);
      const alreadyRefunded = await refundedSoFar(tx, original.id);
      const refundable = original.amount.minus(alreadyRefunded);

      if (amount.greaterThan(refundable)) {
        throw AppError.conflict(
          ErrorCode.REFUND_EXCEEDS_PAYMENT,
          alreadyRefunded.greaterThan(ZERO)
            ? `${alreadyRefunded.toFixed(2)} of this ${original.amount.toFixed(2)} payment has already been refunded — at most ${refundable.toFixed(2)} is left`
            : `This payment collected ${original.amount.toFixed(2)} — ${amount.toFixed(2)} is more than that`,
          { refundable: refundable.toFixed(2), alreadyRefunded: alreadyRefunded.toFixed(2) },
        );
      }

      const refund = await tx.payment.create({
        data: withGeneratedId({
          organizationId: original.organizationId,
          // A refund reverses money in the branch that took it, so it must land in the same
          // branch's revenue — otherwise one branch's total goes up when another issues a refund.
          branchId: original.branchId,
          memberId: original.memberId,
          membershipId: original.membershipId,
          invoiceId: original.invoiceId,
          amount: amount.negated(),
          method: original.method,
          status: "REFUNDED",
          refundOfPaymentId: original.id,
        }),
        include: paymentInclude,
      });

      const invoice = original.invoiceId
        ? await recomputeInvoiceRollup(tx, original.invoiceId)
        : null;

      // Locked Decision 1.16.3 — written in the same transaction as the refund row, so there is
      // no such thing as a refund without its audit entry. `entityId` is the *original* payment,
      // because "what happened to this payment?" is the question the index answers.
      await tx.auditLog.create({
        data: withGeneratedId({
          organizationId: scope.organizationId,
          actorUserId: scope.userId,
          entityType: "Payment",
          entityId: original.id,
          action: "REFUND",
          beforeJson: {
            payment: { id: original.id, amount: original.amount.toFixed(2), status: original.status },
            invoice: original.invoice
              ? {
                  id: original.invoice.id,
                  invoiceNumber: original.invoice.invoiceNumber,
                  status: original.invoice.status,
                }
              : null,
            alreadyRefunded: alreadyRefunded.toFixed(2),
          },
          afterJson: {
            refundPaymentId: refund.id,
            refundedAmount: amount.toFixed(2),
            reason: input.reason ?? null,
            invoice: invoice
              ? {
                  id: invoice.id,
                  invoiceNumber: invoice.invoiceNumber,
                  amountPaid: invoice.amountPaid.toFixed(2),
                  amountPending: invoice.amountPending.toFixed(2),
                  status: invoice.status,
                }
              : null,
          },
        }),
      });

      // Re-read rather than reuse the pre-refund copy, to prove to the caller (and the tests)
      // that the original row really is untouched.
      const originalAfter = await tx.payment.findUniqueOrThrow({
        where: { id: original.id },
        include: paymentInclude,
      });

      return { refund, original: originalAfter, invoice };
    });

    return {
      refund: toPaymentResponse(result.refund),
      original: toPaymentResponse(result.original),
      invoice: result.invoice ? toInvoiceResponse(result.invoice) : null,
    };
  },

  async list(scope: PaymentScope, query: ListPaymentsQuery) {
    const where: Prisma.PaymentWhereInput = {
      organizationId: scope.organizationId,
      member: branchFilter(scope),
      memberId: query.memberId,
      invoiceId: query.invoiceId,
      membershipId: query.membershipId,
      status: query.status,
      method: query.method,
      OR: query.search
        ? [
            { invoice: { invoiceNumber: { contains: query.search } } },
            { member: { firstName: { contains: query.search } } },
            { member: { lastName: { contains: query.search } } },
            { member: { phone: { contains: query.search } } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
        ...paginationSkipTake(query),
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      items: items.map(toPaymentResponse),
      pagination: buildPaginationMeta(query.page, query.limit, total),
    };
  },

  async getById(scope: PaymentScope, paymentId: string): Promise<PaymentResponse> {
    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, organizationId: scope.organizationId, member: branchFilter(scope) },
      include: paymentInclude,
    });

    if (!payment) {
      throw AppError.notFound(ErrorCode.PAYMENT_NOT_FOUND, `Payment "${paymentId}" not found`);
    }

    return toPaymentResponse(payment);
  },

  async listForMember(organizationId: string, memberId: string): Promise<PaymentResponse[]> {
    const rows = await prisma.payment.findMany({
      where: { organizationId, memberId },
      include: paymentInclude,
      orderBy: [{ paidAt: "desc" }, { id: "asc" }],
    });
    return rows.map(toPaymentResponse);
  },
};
