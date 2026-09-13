import { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { closeQueues } from "../../services/queue/queues";
import { startSendWorker, waitForLogTerminal } from "../../services/queue/worker";
import { organizationsDueForNightly, scanOrganization } from "../../services/notification/scan";
import { addDays, todayUtc } from "../../utils/dates";

let tenant: TestTenant;
let owner: TestActor;
let admin: TestActor;
let manager: TestActor;
let receptionist: TestActor;
let trainer: TestActor;
let accountant: TestActor;
let stopWorker: (() => Promise<void>) | undefined;

function url(actor: TestActor, suffix = "") {
  return `/api/v1/organizations/${actor.organization.id}/notifications${suffix}`;
}

async function createMember(organizationId: string, branchId: string, firstName: string) {
  const suffix = generateId().slice(-8);
  return prisma.member.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      firstName,
      lastName: suffix,
      phone: `+9190${suffix}`,
    },
  });
}

async function createTerm(
  organizationId: string,
  branchId: string,
  memberId: string,
  planId: string,
  options: {
    status?: "ACTIVE" | "EXPIRED" | "FROZEN" | "CANCELLED";
    end?: Date;
    start?: Date;
  } = {},
) {
  const today = todayUtc();
  return prisma.membership.create({
    data: {
      id: generateId(),
      organizationId,
      branchId,
      memberId,
      planId,
      priceAtPurchase: new Prisma.Decimal("1500.00"),
      durationDaysAtPurchase: 30,
      startDate: options.start ?? addDays(today, -20),
      endDate: options.end ?? addDays(today, 3),
      status: options.status ?? "ACTIVE",
      frozenAt: options.status === "FROZEN" ? new Date() : null,
    },
  });
}

beforeAll(async () => {
  tenant = await createTestTenant("Notify");
  owner = await createActor(tenant, "OWNER");
  admin = await createActor(tenant, "ADMIN");
  manager = await createActor(tenant, "MANAGER");
  receptionist = await createActor(tenant, "RECEPTIONIST", { branchScoped: true });
  trainer = await createActor(tenant, "TRAINER", { branchScoped: true });
  accountant = await createActor(tenant, "ACCOUNTANT");
  const started = await startSendWorker();
  stopWorker = started.stop;
});

afterAll(async () => {
  await stopWorker?.();
  await closeQueues();
});

describe("notifications RBAC (4.2)", () => {
  it("lets OWNER and ADMIN read the log and refuses everyone else", async () => {
    for (const actor of [owner, admin]) {
      const res = await request(app).get(url(actor, "/logs")).set(...bearer(actor));
      expect(res.status).toBe(200);
    }
    for (const actor of [manager, receptionist, trainer, accountant]) {
      const logs = await request(app).get(url(actor, "/logs")).set(...bearer(actor));
      expect(logs.status).toBe(403);
      expect(logs.body.error.code).toBe("PERMISSION_DENIED");
      const run = await request(app).post(url(actor, "/run")).set(...bearer(actor));
      expect(run.status).toBe(403);
      expect(run.body.error.code).toBe("PERMISSION_DENIED");
    }
  });
});

describe("nightly window (1.22.4)", () => {
  it("selects an IST org at 21:00 IST and not a Honolulu org at the same UTC instant", async () => {
    const ist = await createTestTenant("IstGym");
    await prisma.organization.update({
      where: { id: ist.organization.id },
      data: { timezone: "Asia/Kolkata" },
    });
    const hnl = await createTestTenant("HnlGym");
    await prisma.organization.update({
      where: { id: hnl.organization.id },
      data: { timezone: "Pacific/Honolulu" },
    });

    const ninePmIst = new Date("2026-09-08T15:30:00.000Z");
    const due = await organizationsDueForNightly(ninePmIst);
    expect(due).toContain(ist.organization.id);
    expect(due).not.toContain(hnl.organization.id);
  });
});

describe("scan + worker (1.22.1 / 1.22.2 / 1.22.3)", () => {
  it("queues an expiring membership and an outstanding invoice, then the worker marks SENT", async () => {
    const isolated = await createTestTenant("ScanSent");
    const books = await createActor(isolated, "OWNER");
    const localPlan = await prisma.membershipPlan.create({
      data: {
        id: generateId(),
        organizationId: isolated.organization.id,
        name: "Gold",
        price: new Prisma.Decimal("1500.00"),
        durationDays: 30,
      },
    });
    const today = todayUtc();
    const expiring = await createMember(isolated.organization.id, isolated.branch.id, "Expiry");
    const frozen = await createMember(isolated.organization.id, isolated.branch.id, "Frozen");
    const far = await createMember(isolated.organization.id, isolated.branch.id, "Far");
    const owing = await createMember(isolated.organization.id, isolated.branch.id, "Owing");

    const expiringTerm = await createTerm(
      isolated.organization.id,
      isolated.branch.id,
      expiring.id,
      localPlan.id,
      { end: addDays(today, 3) },
    );
    await createTerm(isolated.organization.id, isolated.branch.id, frozen.id, localPlan.id, {
      status: "FROZEN",
      end: addDays(today, 3),
    });
    await createTerm(isolated.organization.id, isolated.branch.id, far.id, localPlan.id, {
      end: addDays(today, 20),
    });

    const invoice = await prisma.invoice.create({
      data: {
        id: generateId(),
        organizationId: isolated.organization.id,
        branchId: isolated.branch.id,
        memberId: owing.id,
        invoiceNumber: `INV-P12-${generateId().slice(-8)}`,
        amountTotal: new Prisma.Decimal("1500.00"),
        amountPaid: new Prisma.Decimal("0.00"),
        amountPending: new Prisma.Decimal("1500.00"),
        status: "UNPAID",
      },
    });
    await prisma.invoice.create({
      data: {
        id: generateId(),
        organizationId: isolated.organization.id,
        branchId: isolated.branch.id,
        memberId: owing.id,
        invoiceNumber: `INV-P12C-${generateId().slice(-8)}`,
        amountTotal: new Prisma.Decimal("500.00"),
        amountPaid: new Prisma.Decimal("0.00"),
        amountPending: new Prisma.Decimal("0.00"),
        status: "CANCELLED",
      },
    });

    const first = await scanOrganization(isolated.organization.id);
    expect(first.queued).toBe(2);
    expect(first.logIds).toHaveLength(2);

    const terminals = await Promise.all(first.logIds.map((id) => waitForLogTerminal(id)));
    expect(terminals.every((row) => row.status === "SENT")).toBe(true);
    expect(terminals.every((row) => row.sentAt !== null)).toBe(true);

    const events = terminals.map((row) => row.event).sort();
    expect(events).toEqual(["MEMBERSHIP_EXPIRING", "PAYMENT_DUE"]);
    expect(terminals.some((row) => row.entityId === expiringTerm.id)).toBe(true);
    expect(terminals.some((row) => row.entityId === invoice.id)).toBe(true);

    const second = await scanOrganization(isolated.organization.id);
    expect(second.queued).toBe(0);
    expect(second.skipped).toBe(2);

    const count = await prisma.notificationLog.count({
      where: { organizationId: isolated.organization.id },
    });
    expect(count).toBe(2);

    const listed = await request(app).get(url(books, "/logs")).set(...bearer(books));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(2);
  });

  it("marks FAILED after three attempts when the sender throws (1.22.3)", async () => {
    await stopWorker?.();
    const failing = await startSendWorker({
      sender: async () => {
        throw new Error("simulated transport failure");
      },
    });
    stopWorker = failing.stop;

    const isolated = await createTestTenant("ScanFail");
    const failPlan = await prisma.membershipPlan.create({
      data: {
        id: generateId(),
        organizationId: isolated.organization.id,
        name: "FailPlan",
        price: new Prisma.Decimal("900.00"),
        durationDays: 30,
      },
    });
    const member = await createMember(isolated.organization.id, isolated.branch.id, "Failing");
    await createTerm(isolated.organization.id, isolated.branch.id, member.id, failPlan.id, {
      end: addDays(todayUtc(), 2),
    });

    const scanned = await scanOrganization(isolated.organization.id);
    expect(scanned.queued).toBe(1);
    const log = await waitForLogTerminal(scanned.logIds[0]!, 15_000);
    expect(log.status).toBe("FAILED");
    expect(log.lastError).toContain("simulated transport failure");
  });
});
