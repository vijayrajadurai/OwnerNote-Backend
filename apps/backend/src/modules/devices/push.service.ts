import { logger } from "../../utils/logger";
import * as devicesService from "./devices.service";
import { tryGetFirebaseMessaging } from "../auth/firebase.admin";

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

function isInvalidFcmTokenError(code: string | undefined): boolean {
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token" ||
    code === "messaging/invalid-argument"
  );
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const tokens = await devicesService.listTokensForUser(userId);
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  const fcm = tryGetFirebaseMessaging();
  if (!fcm) {
    logger.info({ userId, tokenCount: tokens.length }, "Skipping push: Firebase admin is not configured");
    return { sent: 0, failed: tokens.length };
  }

  const result = await fcm.sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
    android: { priority: "high" },
  });

  await Promise.all(
    result.responses.map(async (response, index) => {
      if (response.success) return;
      const token = tokens[index];
      if (isInvalidFcmTokenError(response.error?.code) && token) {
        await devicesService.deleteTokenValue(token);
      }
    }),
  );

  const sent = result.responses.filter((response) => response.success).length;
  return { sent, failed: result.responses.length - sent };
}
