import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import type { CreateInvoiceInput, ListInvoicesQuery } from "./invoice.schema";
import { invoiceService, type InvoiceScope } from "./invoice.service";

type OrgParams = { organizationId: string };
type InvoiceParams = OrgParams & { invoiceId: string };

/** Scope comes from the verified JWT, never the URL — same contract as every other module. */
function scopeFrom(req: Request): InvoiceScope {
  const auth = getAuth(req);
  return { organizationId: auth.organizationId, branchId: auth.branchId };
}

export const invoiceController = {
  async create(req: Request<OrgParams>, res: Response) {
    const invoice = await invoiceService.create(scopeFrom(req), req.body as CreateInvoiceInput);
    res.status(201).json({ success: true, data: invoice, message: "Invoice raised" });
  },

  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await invoiceService.list(
      scopeFrom(req),
      req.query as unknown as ListInvoicesQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<InvoiceParams>, res: Response) {
    const invoice = await invoiceService.getById(scopeFrom(req), req.params.invoiceId);
    res.status(200).json({ success: true, data: invoice });
  },

  async cancel(req: Request<InvoiceParams>, res: Response) {
    const invoice = await invoiceService.cancel(scopeFrom(req), req.params.invoiceId);
    res.status(200).json({ success: true, data: invoice, message: "Invoice cancelled" });
  },
};
