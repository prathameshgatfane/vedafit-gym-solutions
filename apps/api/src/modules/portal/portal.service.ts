import { Prisma } from "@prisma/client";
import type { MemberAccessTokenPayload } from "../../lib/jwt";
import { attendanceService } from "../attendance/attendance.service";
import { invoiceService } from "../invoices/invoice.service";
import { memberAuthService } from "../auth/member-auth.service";
import { membershipService } from "../memberships/membership.service";
import { paymentService } from "../payments/payment.service";

function outstandingPending(invoices: { amountPending: string }[]): string {
  const total = invoices.reduce(
    (sum, row) => sum.plus(row.amountPending),
    new Prisma.Decimal(0),
  );
  return total.toFixed(2);
}

export const portalService = {
  async home(auth: MemberAccessTokenPayload) {
    const session = await memberAuthService.me(auth);
    const [memberships, invoices] = await Promise.all([
      membershipService.listForMember(auth.organizationId, auth.memberId),
      invoiceService.listForMember(auth.organizationId, auth.memberId),
    ]);
    const current = memberships.find((row) => row.status === "ACTIVE" && !row.isUpcoming) ?? null;
    return {
      ...session,
      currentMembership: current,
      outstandingPending: outstandingPending(invoices),
    };
  },

  profile(auth: MemberAccessTokenPayload) {
    return memberAuthService.me(auth);
  },

  memberships(auth: MemberAccessTokenPayload) {
    return membershipService.listForMember(auth.organizationId, auth.memberId);
  },

  attendance(auth: MemberAccessTokenPayload) {
    return attendanceService.listForMember(auth.organizationId, auth.memberId);
  },

  payments(auth: MemberAccessTokenPayload) {
    return paymentService.listForMember(auth.organizationId, auth.memberId);
  },
};
