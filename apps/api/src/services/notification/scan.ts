import type { NotificationChannel, NotificationEvent } from "@prisma/client";
import { env } from "../../config/env";
import { prisma, withGeneratedId } from "../../lib/prisma";
import {
  addDays,
  daysBetween,
  formatCalendarDate,
  isNightlyWindow,
  localCalendarDate,
  safeTimeZone,
  todayUtc,
} from "../../utils/dates";
import { sendQueue } from "../queue/queues";
import { renderTemplate } from "./render";
import { ensureDefaultTemplates, isUniqueConflict } from "./templates";

export interface ScanResult {
  queued: number;
  skipped: number;
  logIds: string[];
}

const EXPIRY_WINDOW_DAYS = 7;

export async function organizationsDueForNightly(asOf: Date): Promise<string[]> {
  const orgs = await prisma.organization.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, timezone: true },
  });
  return orgs
    .filter((org) => isNightlyWindow(asOf, org.timezone, env.NIGHTLY_LOCAL_HOUR))
    .map((org) => org.id);
}

export async function runNightlyTick(asOf: Date = new Date()): Promise<ScanResult> {
  const due = await organizationsDueForNightly(asOf);
  const totals: ScanResult = { queued: 0, skipped: 0, logIds: [] };
  for (const organizationId of due) {
    const result = await scanOrganization(organizationId, asOf);
    totals.queued += result.queued;
    totals.skipped += result.skipped;
    totals.logIds.push(...result.logIds);
  }
  return totals;
}

/**
 * Find who should be notified today and enqueue one send job per intended row (1.22.1).
 * The unique constraint is the lock; BullMQ `jobId = log.id` is the Redis backstop.
 */
export async function scanOrganization(
  organizationId: string,
  asOf: Date = new Date(),
): Promise<ScanResult> {
  await ensureDefaultTemplates(organizationId);

  const organization = await prisma.organization.findFirstOrThrow({
    where: { id: organizationId },
    select: { id: true, name: true, timezone: true },
  });
  const timeZone = safeTimeZone(organization.timezone);
  const localDate = localCalendarDate(asOf, timeZone);
  const today = todayUtc(asOf);
  const windowEnd = addDays(today, EXPIRY_WINDOW_DAYS - 1);

  const templates = await prisma.notificationTemplate.findMany({
    where: { organizationId, channel: "SMS" },
  });
  const templateByEvent = new Map(templates.map((row) => [row.event, row]));

  const result: ScanResult = { queued: 0, skipped: 0, logIds: [] };

  const expiryTemplate = templateByEvent.get("MEMBERSHIP_EXPIRING");
  if (expiryTemplate) {
    const memberships = await prisma.membership.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        startDate: { lte: today },
        endDate: { gte: today, lte: windowEnd },
        member: { deletedAt: null, status: { not: "ARCHIVED" } },
      },
      include: {
        member: { select: { id: true, firstName: true, lastName: true } },
        plan: { select: { name: true } },
      },
    });

    for (const membership of memberships) {
      const body = renderTemplate(expiryTemplate.body, {
        memberName: `${membership.member.firstName} ${membership.member.lastName}`,
        planName: membership.plan.name,
        orgName: organization.name,
        endDate: formatCalendarDate(membership.endDate),
        daysRemaining: String(daysBetween(today, membership.endDate)),
      });
      await intendSend(result, {
        organizationId,
        memberId: membership.member.id,
        event: "MEMBERSHIP_EXPIRING",
        channel: expiryTemplate.channel,
        entityType: "MEMBERSHIP",
        entityId: membership.id,
        localDate,
        body,
      });
    }
  }

  const dueTemplate = templateByEvent.get("PAYMENT_DUE");
  if (dueTemplate) {
    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId,
        amountPending: { gt: 0 },
        member: { deletedAt: null, status: { not: "ARCHIVED" } },
      },
      include: { member: { select: { id: true, firstName: true, lastName: true } } },
    });

    for (const invoice of invoices) {
      const body = renderTemplate(dueTemplate.body, {
        memberName: `${invoice.member.firstName} ${invoice.member.lastName}`,
        orgName: organization.name,
        amountPending: invoice.amountPending.toFixed(2),
        invoiceNumber: invoice.invoiceNumber,
      });
      await intendSend(result, {
        organizationId,
        memberId: invoice.member.id,
        event: "PAYMENT_DUE",
        channel: dueTemplate.channel,
        entityType: "INVOICE",
        entityId: invoice.id,
        localDate,
        body,
      });
    }
  }

  return result;
}

async function intendSend(
  result: ScanResult,
  data: {
    organizationId: string;
    memberId: string;
    event: NotificationEvent;
    channel: NotificationChannel;
    entityType: "MEMBERSHIP" | "INVOICE";
    entityId: string;
    localDate: Date;
    body: string;
  },
): Promise<void> {
  let logId: string;
  try {
    const log = await prisma.notificationLog.create({
      data: withGeneratedId({
        organizationId: data.organizationId,
        memberId: data.memberId,
        event: data.event,
        channel: data.channel,
        status: "QUEUED",
        entityType: data.entityType,
        entityId: data.entityId,
        localDate: data.localDate,
        body: data.body,
      }),
      select: { id: true },
    });
    logId = log.id;
  } catch (error) {
    if (isUniqueConflict(error)) {
      result.skipped += 1;
      return;
    }
    throw error;
  }

  try {
    await sendQueue().add(
      "send",
      { logId },
      {
        jobId: logId,
        attempts: env.NOTIFICATION_ATTEMPTS,
        backoff: { type: "exponential", delay: env.NOTIFICATION_BACKOFF_MS },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    );
  } catch (error) {
    await prisma.notificationLog.delete({ where: { id: logId } });
    throw error;
  }

  result.queued += 1;
  result.logIds.push(logId);
}
