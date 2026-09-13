import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../../../test/helpers/app";
import {
  bearer,
  createActor,
  createTestTenant,
  type TestActor,
  type TestTenant,
} from "../../../test/helpers/auth";
import { generateId } from "../../lib/id";
import { prisma } from "../../lib/prisma";

let tenant: TestTenant;
let otherBranch: { id: string };
let owner: TestActor;
let manager: TestActor;
let receptionist: TestActor;
let trainer: TestActor;
let accountant: TestActor;

function url(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/leads${suffix}`;
}

function uniquePhone() {
  const unique = Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, "0");
  return `+91${unique}`;
}

async function createLead(actor: TestActor, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(url(actor))
    .set(...bearer(actor))
    .send({
      name: "Walk-in Priya",
      phone: uniquePhone(),
      source: "walk-in",
      branchId: actor.user.branchId ? undefined : tenant.branch.id,
      ...overrides,
    });
  if (res.status !== 201) {
    throw new Error(`Lead create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string; phone: string; status: string; branchId: string | null };
}

beforeAll(async () => {
  tenant = await createTestTenant("Leads");
  otherBranch = await prisma.branch.create({
    data: {
      id: generateId(),
      organizationId: tenant.organization.id,
      name: `Other ${generateId().slice(-4)}`,
    },
  });
  owner = await createActor(tenant, "OWNER");
  manager = await createActor(tenant, "MANAGER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
  trainer = await createActor(tenant, "TRAINER", { branchScoped: true });
  accountant = await createActor(tenant, "ACCOUNTANT");
});

describe("POST /leads — create", () => {
  it("creates a NEW lead and stamps a branch-scoped caller's branch", async () => {
    const res = await request(app)
      .post(url(receptionist))
      .set(...bearer(receptionist))
      .send({ name: "Aarav Walkin", phone: uniquePhone(), source: "walk-in" });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("NEW");
    expect(res.body.data.branchId).toBe(tenant.branch.id);
    expect(res.body.data.allowedTransitions).toEqual(["CONTACTED", "TRIAL_SCHEDULED", "LOST"]);
  });

  it("refuses a second open lead with the same phone (1.20.4)", async () => {
    const phone = uniquePhone();
    await createLead(manager, { phone });
    const res = await request(app)
      .post(url(manager))
      .set(...bearer(manager))
      .send({ name: "Duplicate", phone, branchId: tenant.branch.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_OPEN_LEAD");
  });
});

describe("PATCH /leads/:id — pipeline (1.20.1)", () => {
  it("allows skipping CONTACTED and refuses a backward move", async () => {
    const lead = await createLead(manager);

    const skipped = await request(app)
      .patch(url(manager, `/${lead.id}`))
      .set(...bearer(manager))
      .send({ status: "TRIAL_SCHEDULED" });
    expect(skipped.status).toBe(200);
    expect(skipped.body.data.status).toBe("TRIAL_SCHEDULED");

    const back = await request(app)
      .patch(url(manager, `/${lead.id}`))
      .set(...bearer(manager))
      .send({ status: "CONTACTED" });
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe("INVALID_LEAD_TRANSITION");
  });

  it("lets LOST reopen to CONTACTED, not to NEW or TRIAL_SCHEDULED", async () => {
    const lead = await createLead(manager);
    await request(app)
      .patch(url(manager, `/${lead.id}`))
      .set(...bearer(manager))
      .send({ status: "LOST" })
      .expect(200);

    const toNew = await request(app)
      .patch(url(manager, `/${lead.id}`))
      .set(...bearer(manager))
      .send({ status: "NEW" });
    expect(toNew.status).toBe(409);

    const toTrial = await request(app)
      .patch(url(manager, `/${lead.id}`))
      .set(...bearer(manager))
      .send({ status: "TRIAL_SCHEDULED" });
    expect(toTrial.status).toBe(409);

    const reopened = await request(app)
      .patch(url(manager, `/${lead.id}`))
      .set(...bearer(manager))
      .send({ status: "CONTACTED" });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe("CONTACTED");
  });

  it("refuses PATCH status CONVERTED — convert is its own endpoint", async () => {
    const lead = await createLead(manager);
    const res = await request(app)
      .patch(url(manager, `/${lead.id}`))
      .set(...bearer(manager))
      .send({ status: "CONVERTED" });
    expect(res.status).toBe(400);
  });

  it("lets a LOST phone open a new lead (1.20.4)", async () => {
    const lostPhone = uniquePhone();
    const lost = await createLead(manager, { phone: lostPhone });
    await request(app)
      .patch(url(manager, `/${lost.id}`))
      .set(...bearer(manager))
      .send({ status: "LOST" })
      .expect(200);

    const again = await createLead(manager, { phone: lostPhone, name: "Returned" });
    expect(again.id).not.toBe(lost.id);
  });
});

describe("POST /leads/:id/convert (1.20.2)", () => {
  it("creates a member, stamps convertedMemberId, and freezes the lead", async () => {
    const lead = await createLead(manager, { name: "Zoya Convert" });

    const res = await request(app)
      .post(url(manager, `/${lead.id}/convert`))
      .set(...bearer(manager))
      .send({
        firstName: "Zoya",
        lastName: "Convert",
        branchId: tenant.branch.id,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CONVERTED");
    expect(res.body.data.convertedMemberId).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
    expect(res.body.data.convertedMember.firstName).toBe("Zoya");
    expect(res.body.data.convertedMember.phone).toBe(lead.phone);
    expect(res.body.data.allowedTransitions).toEqual([]);

    const member = await prisma.member.findUnique({
      where: { id: res.body.data.convertedMemberId },
    });
    expect(member?.phone).toBe(lead.phone);
    expect(member?.branchId).toBe(tenant.branch.id);

    const patch = await request(app)
      .patch(url(manager, `/${lead.id}`))
      .set(...bearer(manager))
      .send({ name: "Nope" });
    expect(patch.status).toBe(409);
    expect(patch.body.error.code).toBe("LEAD_CONVERTED");

    const twice = await request(app)
      .post(url(manager, `/${lead.id}/convert`))
      .set(...bearer(manager))
      .send({ firstName: "Zoya", lastName: "Convert", branchId: tenant.branch.id });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("LEAD_CONVERTED");
  });

  it("converts from NEW without requiring a trial, and refuses from LOST", async () => {
    const fresh = await createLead(manager);
    const ok = await request(app)
      .post(url(manager, `/${fresh.id}/convert`))
      .set(...bearer(manager))
      .send({ firstName: "Same", lastName: "Day", branchId: tenant.branch.id });
    expect(ok.status).toBe(200);

    const lost = await createLead(manager);
    await request(app)
      .patch(url(manager, `/${lost.id}`))
      .set(...bearer(manager))
      .send({ status: "LOST" });
    const refused = await request(app)
      .post(url(manager, `/${lost.id}/convert`))
      .set(...bearer(manager))
      .send({ firstName: "No", lastName: "Pe", branchId: tenant.branch.id });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("LEAD_NOT_CONVERTIBLE");
  });

  it("refuses conversion when the phone already belongs to a member (1.3)", async () => {
    const phone = uniquePhone();
    await prisma.member.create({
      data: {
        id: generateId(),
        organizationId: tenant.organization.id,
        branchId: tenant.branch.id,
        firstName: "Existing",
        lastName: "Member",
        phone,
      },
    });
    const lead = await createLead(manager, { phone });
    const res = await request(app)
      .post(url(manager, `/${lead.id}/convert`))
      .set(...bearer(manager))
      .send({ firstName: "Dup", lastName: "Phone", branchId: tenant.branch.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_PHONE");

    const still = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(still?.status).toBe("NEW");
    expect(still?.convertedMemberId).toBeNull();
  });

  it("lets a converted phone open a new enquiry cycle (1.20.4)", async () => {
    const phone = uniquePhone();
    const lead = await createLead(manager, { phone });
    await request(app)
      .post(url(manager, `/${lead.id}/convert`))
      .set(...bearer(manager))
      .send({ firstName: "Once", lastName: "Member", branchId: tenant.branch.id })
      .expect(200);

    const again = await createLead(manager, { phone, name: "Same number, new cycle" });
    expect(again.id).not.toBe(lead.id);
    expect(again.status).toBe("NEW");
  });
});

describe("leads scoping and RBAC", () => {
  it("404s a branch-scoped receptionist asking about another branch's lead", async () => {
    const lead = await createLead(manager, { branchId: otherBranch.id });
    const res = await request(app)
      .get(url(receptionist, `/${lead.id}`))
      .set(...bearer(receptionist));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("LEAD_NOT_FOUND");
  });

  it("lists assignees who hold leads.manage and omits a trainer", async () => {
    const res = await request(app).get(url(manager, "/assignees")).set(...bearer(manager));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((row: { id: string }) => row.id);
    expect(ids).toContain(receptionist.user.id);
    expect(ids).toContain(manager.user.id);
    expect(ids).not.toContain(trainer.user.id);
    expect(ids).not.toContain(accountant.user.id);
  });

  it("lets a RECEPTIONIST manage leads and refuses TRAINER and ACCOUNTANT", async () => {
    const ok = await request(app).get(url(receptionist)).set(...bearer(receptionist));
    expect(ok.status).toBe(200);

    for (const actor of [trainer, accountant]) {
      const res = await request(app).get(url(actor)).set(...bearer(actor));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("PERMISSION_DENIED");
    }
  });

  it("rejects org A's token against org B's leads", async () => {
    const stranger = await createTestTenant("LeadCross");
    const res = await request(app)
      .get(`/api/v1/organizations/${stranger.organization.id}/leads`)
      .set(...bearer(owner));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORG_MISMATCH");
  });
});
