import { logger } from "../../lib/logger";

export interface SendPayload {
  logId: string;
  event: string;
  channel: string;
  body: string;
  memberId: string | null;
}

export type NotificationSender = (payload: SendPayload) => Promise<void>;

/**
 * The Phase 12 transport: write the rendered body at info and return. No SMS, email, or
 * WhatsApp provider is wired (1.22.3). A test injects a throwing sender to prove retries.
 */
export const logOnlySender: NotificationSender = async (payload) => {
  logger.info(
    {
      transport: "log",
      logId: payload.logId,
      event: payload.event,
      channel: payload.channel,
      memberId: payload.memberId,
      body: payload.body,
    },
    "notification.send",
  );
};
