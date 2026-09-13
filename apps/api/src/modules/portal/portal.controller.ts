import type { Request, Response } from "express";
import { getMemberAuth } from "../../middleware/auth.middleware";
import { portalService } from "./portal.service";

export const portalController = {
  async home(req: Request, res: Response) {
    const data = await portalService.home(getMemberAuth(req));
    res.status(200).json({ success: true, data });
  },

  async profile(req: Request, res: Response) {
    const data = await portalService.profile(getMemberAuth(req));
    res.status(200).json({ success: true, data });
  },

  async memberships(req: Request, res: Response) {
    const data = await portalService.memberships(getMemberAuth(req));
    res.status(200).json({ success: true, data });
  },

  async attendance(req: Request, res: Response) {
    const data = await portalService.attendance(getMemberAuth(req));
    res.status(200).json({ success: true, data });
  },

  async payments(req: Request, res: Response) {
    const data = await portalService.payments(getMemberAuth(req));
    res.status(200).json({ success: true, data });
  },
};
