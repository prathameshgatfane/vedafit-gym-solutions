import type { Request, Response } from "express";
import { getAuth } from "../../middleware/auth.middleware";
import { memberService, type MemberScope } from "./member.service";
import type { CreateMemberInput, ListMembersQuery, UpdateMemberInput } from "./member.schema";

type OrgParams = { organizationId: string };
type MemberParams = { organizationId: string; memberId: string };

/**
 * The scope always comes from the verified JWT, never from the URL or body. `tenantScope` has
 * already rejected any request whose supplied ids disagree with the token, so by this point
 * `req.params.organizationId` and the token's claim are the same value — reading the token
 * keeps that a guarantee of this code rather than of middleware ordering.
 */
function scopeFrom(req: Request): MemberScope {
  const auth = getAuth(req);
  return {
    organizationId: auth.organizationId,
    branchId: auth.branchId,
    userId: auth.userId,
    roleId: auth.roleId,
  };
}

export const memberController = {
  async create(req: Request<OrgParams>, res: Response) {
    const member = await memberService.create(scopeFrom(req), req.body as CreateMemberInput);
    res.status(201).json({ success: true, data: member, message: "Member created" });
  },

  async list(req: Request<OrgParams>, res: Response) {
    const { items, pagination } = await memberService.list(
      scopeFrom(req),
      req.query as unknown as ListMembersQuery,
    );
    res.status(200).json({ success: true, data: items, pagination });
  },

  async getById(req: Request<MemberParams>, res: Response) {
    const member = await memberService.getById(scopeFrom(req), req.params.memberId);
    res.status(200).json({ success: true, data: member });
  },

  async update(req: Request<MemberParams>, res: Response) {
    const member = await memberService.update(
      scopeFrom(req),
      req.params.memberId,
      req.body as UpdateMemberInput,
    );
    res.status(200).json({ success: true, data: member, message: "Member updated" });
  },

  async archive(req: Request<MemberParams>, res: Response) {
    const member = await memberService.archive(scopeFrom(req), req.params.memberId);
    res.status(200).json({ success: true, data: member, message: "Member archived" });
  },
};
