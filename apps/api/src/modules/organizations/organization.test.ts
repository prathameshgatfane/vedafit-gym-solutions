import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../../test/helpers/app";
import { uniqueSuffix } from "../../../test/helpers/fixtures";
import { ULID_LOWERCASE_PATTERN } from "../../lib/id";

const BASE = "/api/v1/organizations";

describe("organizations module", () => {
  it("creates an organization with a lowercase-ULID id (happy path)", async () => {
    const suffix = uniqueSuffix();
    const res = await request(app)
      .post(BASE)
      .send({ name: `Acme Gym ${suffix}`, slug: `acme-gym-${suffix}`, email: `acme-${suffix}@example.test` });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toMatch(ULID_LOWERCASE_PATTERN);
    expect(res.body.data.name).toBe(`Acme Gym ${suffix}`);
    expect(res.body.data.status).toBe("ACTIVE");
  });

  it("rejects a request missing required fields with VALIDATION_ERROR", async () => {
    const res = await request(app).post(BASE).send({ name: "No slug or email" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a duplicate slug with 409 DUPLICATE_ORGANIZATION_SLUG", async () => {
    const suffix = uniqueSuffix();
    const payload = { name: `Dup Gym ${suffix}`, slug: `dup-gym-${suffix}`, email: `dup-${suffix}@example.test` };

    const first = await request(app).post(BASE).send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(BASE)
      .send({ ...payload, name: "Different name, same slug" });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("DUPLICATE_ORGANIZATION_SLUG");
  });

  it("lists organizations filtered by search, with correct pagination shape", async () => {
    const suffix = uniqueSuffix();
    const slug = `searchable-${suffix}`;
    await request(app)
      .post(BASE)
      .send({ name: `Searchable Gym ${suffix}`, slug, email: `searchable-${suffix}@example.test` });

    const res = await request(app).get(BASE).query({ search: slug, page: 1, limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].slug).toBe(slug);
    expect(res.body.pagination).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
  });

  it("gets an organization by id", async () => {
    const suffix = uniqueSuffix();
    const created = await request(app)
      .post(BASE)
      .send({ name: `Getme Gym ${suffix}`, slug: `getme-${suffix}`, email: `getme-${suffix}@example.test` });

    const res = await request(app).get(`${BASE}/${created.body.data.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(created.body.data.id);
  });

  it("returns 404 ORGANIZATION_NOT_FOUND for an unknown id", async () => {
    const res = await request(app).get(`${BASE}/not-a-real-id`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ORGANIZATION_NOT_FOUND");
  });

  it("updates an organization's name and status", async () => {
    const suffix = uniqueSuffix();
    const created = await request(app)
      .post(BASE)
      .send({ name: `Before ${suffix}`, slug: `update-${suffix}`, email: `update-${suffix}@example.test` });

    const res = await request(app)
      .patch(`${BASE}/${created.body.data.id}`)
      .send({ name: `After ${suffix}`, status: "SUSPENDED" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(`After ${suffix}`);
    expect(res.body.data.status).toBe("SUSPENDED");
  });
});
