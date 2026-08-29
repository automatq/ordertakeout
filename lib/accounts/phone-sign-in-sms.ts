import "server-only";

import { serverEnv } from "@/lib/env";
import { reportError } from "@/lib/monitoring/report";
import { PHONE_CODE_TTL_MINUTES } from "@/lib/accounts/phone-sign-in";
import { SMS_SEGMENT_LIMIT } from "@/lib/notifications/render";

/**
 * Sends the sign-in code straight through Twilio rather than the order
 * dispatcher: `notification_log.order_id` is NOT NULL, and a sign-in attempt
 * has no order. Reuses the same TWILIO_* credentials as customer order texts.
 *
 * The code is never written to logs or error reports — only the outcome is.
 */
export async function sendPhoneSignInCode(input: {
  to: string;
  code: string;
}): Promise<boolean> {
  const env = serverEnv();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    reportError("accounts", "phone sign-in requested but Twilio is not configured", null);
    return false;
  }
  if (!/^\+\d{8,15}$/.test(input.to)) return false;

  /* Plain ASCII and one segment. The literal word "code" beside the digits is
     what lets iOS and Android offer it as a one-tap keyboard suggestion. */
  const body =
    `Harina: your sign-in code is ${input.code}. ` +
    `It expires in ${PHONE_CODE_TTL_MINUTES} minutes. ` +
    `If you didn't request it, ignore this message.`;

  const credentials = Buffer.from(
    `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
  ).toString("base64");

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: input.to,
          From: env.TWILIO_FROM_NUMBER,
          Body: body.slice(0, SMS_SEGMENT_LIMIT),
        }).toString(),
      },
    );
    if (!response.ok) {
      reportError("accounts", `phone sign-in SMS failed with HTTP ${response.status}`, null);
      return false;
    }
    return true;
  } catch (cause) {
    reportError("accounts", "phone sign-in SMS failed", cause);
    return false;
  }
}
