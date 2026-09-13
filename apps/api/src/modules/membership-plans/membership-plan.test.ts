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

let tenant: TestTenant;
let owner: TestActor;
let receptionist: TestActor;
let trainer: TestActor;

function plansUrl(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/membership-plans${suffix}`;
}

function newPlan(overrides: Record<string, unknown> = {}) {
  // Randomized so the org-wide active-name check can't collide across test files.
  return {
    name: `Plan ${generateId().slice(-8)}`,
    price: 1500,
    durationDays: 30,
    ...overrides,
  };
}

async function createPlan(actor: TestActor, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(plansUrl(actor))
    .set(...bearer(actor))
    .send(newPlan(overrides));

  if (res.status !== 201) {
    throw new Error(`Plan create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.data as { id: string; name: string; price: string; durationDays: number };
}

beforeAll(async () => {
  tenant = await createTestTenant("Plans");
  owner = await createActor(tenant, "OWNER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
  trainer = await createActor(tenant, "TRAINER");
});

describe("membership-plans — create", () => {
  it("creates an ACTIVE plan and returns price as a fixed-2 string", async () => {
    const res = await request(app)
      .post(plansUrl(owner))
      .set(...bearer(owner))
      .send(newPlan({ name: `Gold ${generateId().slice(-6)}`, price: 1499.5, durationDays: 90 }));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      price: "1499.50",
      durationDays: 90,
      status: "ACTIVE",
      organizationId: tenant.organization.id,
    });
    expect(res.body.data.id).toMatch(/^[0-9a-hjkmnp-tv-z]{26}$/);
  });

  it("rejects a price with more than two decimals rather than silently rounding it", async () => {
    const res = await request(app)
      .post(plansUrl(owner))
      .set(...bearer(owner))
      .send(newPlan({ price: 10.999 }));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a negative price and a zero-day duration", async () => {
    const negative = await request(app)
      .post(plansUrl(owner))
      .set(...bearer(owner))
      .send(newPlan({ price: -1 }));
    expect(negative.status).toBe(400);

    const zeroDays = await request(app)
      .post(plansUrl(owner))
      .set(...bearer(owner))
      .send(newPlan({ durationDays: 0 }));
    expect(zeroDays.status).toBe(400);
  });

  it("rejects a second ACTIVE plan with the same name, case-insensitively", async () => {
    const name = `Platinum ${generateId().slice(-6)}`;
    await createPlan(owner, { name });

    const res = await request(app)
      .post(plansUrl(owner))
      .set(...bearer(owner))
      .send(newPlan({ name: name.toUpperCase() }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_PLAN_NAME");
  });

  it("frees the name up again once the original plan is retired", async () => {
    const name = `Seasonal ${generateId().slice(-6)}`;
    const first = await createPlan(owner, { name });

    await request(app)
      .patch(plansUrl(owner, `/${first.id}`))
      .set(...bearer(owner))
      .send({ status: "INACTIVE" })
      .expect(200);

    const res = await request(app)
      .post(plansUrl(owner))
      .set(...bearer(owner))
      .send(newPlan({ name, price: 2000 }));

    expect(res.status).toBe(201);
    expect(res.body.data.price).toBe("2000.00");
  });

  it("refuses to reactivate a retired plan whose name is now taken by a live one", async () => {
    const name = `Contested ${generateId().slice(-6)}`;
    const retired = await createPlan(owner, { name });
    await request(app)
      .patch(plansUrl(owner, `/${retired.id}`))
      .set(...bearer(owner))
      .send({ status: "INACTIVE" })
      .expect(200);
    await createPlan(owner, { name });

    const res = await request(app)
      .patch(plansUrl(owner, `/${retired.id}`))
      .set(...bearer(owner))
      .send({ status: "ACTIVE" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_PLAN_NAME");
  });
});

describe("membership-plans — list, view, update", () => {
  it("applies search, status filter, sort and pagination together (Section 1.9)", async () => {
    const marker = generateId().slice(-6);
    await createPlan(owner, { name: `Combo ${marker} A`, price: 300, durationDays: 30 });
    await createPlan(owner, { name: `Combo ${marker} B`, price: 200, durationDays: 60 });
    const retired = await createPlan(owner, { name: `Combo ${marker} C`, price: 100 });
    await request(app)
      .patch(plansUrl(owner, `/${retired.id}`))
      .set(...bearer(owner))
      .send({ status: "INACTIVE" })
      .expect(200);

    const res = await request(app)
      .get(plansUrl(owner))
      .query({ search: `Combo ${marker}`, status: "ACTIVE", sortBy: "price", sortOrder: "asc", page: 1, limit: 1 })
      .set(...bearer(owner));

    expect(res.status).toBe(200);
    // The retired plan is excluded by the filter, so the total is 2 — and the cheapest of the
    // two, not of all three, is the one page 1 returns.
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe(`Combo ${marker} B`);

    const page2 = await request(app)
      .get(plansUrl(owner))
      .query({ search: `Combo ${marker}`, status: "ACTIVE", sortBy: "price", sortOrder: "asc", page: 2, limit: 1 })
      .set(...bearer(owner));
    expect(page2.body.data[0].name).toBe(`Combo ${marker} A`);
  });

  it("404s for a plan id that belongs to nobody", async () => {
    const res = await request(app)
      .get(plansUrl(owner, `/${generateId()}`))
      .set(...bearer(owner));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEMBERSHIP_PLAN_NOT_FOUND");
  });

  it("rejects an empty update body", async () => {
    const plan = await createPlan(owner);
    const res = await request(app)
      .patch(plansUrl(owner, `/${plan.id}`))
      .set(...bearer(owner))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("has no DELETE — retiring a plan is a status change, so history survives", async () => {
    const plan = await createPlan(owner);
    const res = await request(app)
      .delete(plansUrl(owner, `/${plan.id}`))
      .set(...bearer(owner));

    expect(res.status).toBe(404);
  });
});

describe("membership-plans — RBAC and tenancy", () => {
  it("lets a RECEPTIONIST read the catalog but not change it", async () => {
    const plan = await createPlan(owner);

    const read = await request(app)
      .get(plansUrl(receptionist, `/${plan.id}`))
      .set(...bearer(receptionist));
    expect(read.status).toBe(200);

    const write = await request(app)
      .patch(plansUrl(receptionist, `/${plan.id}`))
      .set(...bearer(receptionist))
      .send({ price: 1 });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe("PERMISSION_DENIED");

    const create = await request(app)
      .post(plansUrl(receptionist))
      .set(...bearer(receptionist))
      .send(newPlan());
    expect(create.status).toBe(403);
  });

  it("denies a TRAINER, who holds no membership-plans permission at all", async () => {
    const res = await request(app)
      .get(plansUrl(trainer))
      .set(...bearer(trainer));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("denies another organization's owner", async () => {
    const plan = await createPlan(owner);
    const stranger = await createActor(await createTestTenant("Other Plans"), "OWNER");

    const crossOrg = await request(app)
      .get(plansUrl(owner, `/${plan.id}`))
      .set(...bearer(stranger));
    expect(crossOrg.status).toBe(403);
    expect(crossOrg.body.error.code).toBe("ORG_MISMATCH");

    // And the plan is invisible from inside their own org, not merely forbidden by URL.
    const ownScope = await request(app)
      .get(plansUrl(stranger, `/${plan.id}`))
      .set(...bearer(stranger));
    expect(ownScope.status).toBe(404);
  });
});
