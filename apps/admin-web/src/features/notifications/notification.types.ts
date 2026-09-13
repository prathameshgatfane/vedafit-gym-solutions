export const NOTIFICATION_EVENTS = ["MEMBERSHIP_EXPIRING", "PAYMENT_DUE"] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_CHANNELS = ["SMS", "EMAIL", "PUSH"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_LOG_STATUSES = ["QUEUED", "SENT", "FAILED"] as const;
export type NotificationLogStatus = (typeof NOTIFICATION_LOG_STATUSES)[number];

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  MEMBERSHIP_EXPIRING: "Membership expiring",
  PAYMENT_DUE: "Payment due",
};

export interface NotificationMember {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

export interface NotificationLog {
  id: string;
  organizationId: string;
  memberId: string | null;
  event: NotificationEvent;
  channel: NotificationChannel;
  status: NotificationLogStatus;
  entityType: "MEMBERSHIP" | "INVOICE";
  entityId: string;
  localDate: string;
  body: string;
  lastError: string | null;
  sentAt: string | null;
  createdAt: string;
  member: NotificationMember | null;
}

export interface NotificationTemplate {
  id: string;
  organizationId: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  body: string;
  updatedAt: string;
}

export interface ScanResult {
  queued: number;
  skipped: number;
  logIds: string[];
}

export type NotificationSortField = "createdAt" | "sentAt" | "event";

export type NotificationListParams = import("../../lib/url-list-params").ListParams<
  NotificationSortField,
  NotificationLogStatus
>;

export const DEFAULT_NOTIFICATION_LIST_PARAMS: NotificationListParams = {
  page: 1,
  limit: 20,
  search: "",
  status: "",
  sortBy: "createdAt",
  sortOrder: "desc",
};
