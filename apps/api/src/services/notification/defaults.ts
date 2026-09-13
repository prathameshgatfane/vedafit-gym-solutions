import type { NotificationEvent } from "@prisma/client";

export const DEFAULT_SMS_TEMPLATES: {
  event: NotificationEvent;
  body: string;
}[] = [
  {
    event: "MEMBERSHIP_EXPIRING",
    body: "Hi {{memberName}}, your {{planName}} membership at {{orgName}} expires on {{endDate}} ({{daysRemaining}} day(s) left).",
  },
  {
    event: "PAYMENT_DUE",
    body: "Hi {{memberName}}, you have Rs {{amountPending}} outstanding at {{orgName}} (invoice {{invoiceNumber}}).",
  },
];
