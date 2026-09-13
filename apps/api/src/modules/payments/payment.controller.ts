import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import type {
  CreatePaymentInput,
  ListPaymentsQuery,
  RefundPaymentInput,
} from "./payment.schema";
import { paymentService, type PaymentScope } from "./payment.service";

type OrgParams = { organizationId: string };
type PaymentParams = OrgParams & { paymentId: string };

/**
 * Scope comes from the verified JWT, never the URL or the body — including `userId`, which
 * becomes the actor on a refund's audit entry. A client-supplied actor would make the audit log
 * worth less than nothing.
 */
function scopeFrom(req: Request): PaymentScope {
  const auth = getAuth(req);
  return {
    organizationId: auth.organizationId,
    branchId: auth.branchId,
    userId: auth.userId,
  };
}

export const paymentController = {
  async create(req: Request<OrgParams>, res: Response) {
    const result = await paymentService.create(scopeFrom(req), req.body as CreatePaymentInput);
    res.status(201).json({ success: true, data: result, message: "Payment recorded" });
  },

  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await paymentService.list(
      scopeFrom(req),
      req.query as unknown as ListPaymentsQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<PaymentParams>, res: Response) {
    const payment = await paymentService.getById(scopeFrom(req), req.params.paymentId);
    res.status(200).json({ success: true, data: payment });
  },

  async refund(req: Request<PaymentParams>, res: Response) {
    const result = await paymentService.refund(
      scopeFrom(req),
      req.params.paymentId,
      req.body as RefundPaymentInput,
    );
    res.status(201).json({ success: true, data: result, message: "Refund recorded" });
  },
};
