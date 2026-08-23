import "server-only";

import { serverEnv } from "@/lib/env";
import { reportError } from "@/lib/monitoring/report";
import { EMAIL_COLORS, escapeHtml } from "@/lib/notifications/email-html";
import { MAGIC_LINK_TTL_MINUTES } from "@/lib/accounts/magic-link";
import { STORE_INFO } from "@/lib/store";

/**
 * Sends the sign-in email directly through Resend rather than the order
 * dispatcher: `notification_log.order_id` is NOT NULL by design, and a sign-in
 * attempt has no order. Reuses the same Resend credentials and the order
 * emails' visual language (EMAIL_COLORS, table layout).
 */
export async function sendMagicLinkEmail(input: {
  to: string;
  name: string;
  url: string;
}): Promise<boolean> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.NOTIFY_FROM_EMAIL) {
    reportError("accounts", "magic link requested but Resend is not configured", null);
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.NOTIFY_FROM_EMAIL,
        to: [input.to],
        subject: `Sign in to ${STORE_INFO.name}`,
        text: [
          `Hi ${input.name.split(" ")[0] ?? input.name},`,
          "",
          `Use this link to sign in to your ${STORE_INFO.name} account:`,
          input.url,
          "",
          `The link works once and expires in ${MAGIC_LINK_TTL_MINUTES} minutes.`,
          "If you didn't request it, you can ignore this email — nobody can sign in without it.",
        ].join("\n"),
        html: renderMagicLinkHtml(input),
      }),
    });
    if (!response.ok) {
      reportError("accounts", `magic link email failed with HTTP ${response.status}`, null);
      return false;
    }
    return true;
  } catch (cause) {
    reportError("accounts", "magic link email failed", cause);
    return false;
  }
}

function renderMagicLinkHtml(input: { name: string; url: string }): string {
  const c = EMAIL_COLORS;
  const firstName = escapeHtml(input.name.split(" ")[0] ?? input.name);
  const url = escapeHtml(input.url);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign in to ${escapeHtml(STORE_INFO.name)}</title>
</head>
<body style="margin:0;padding:0;background-color:${c.canvas};">
  <div style="display:none;max-height:0;overflow:hidden;">Your one-time sign-in link — expires in ${MAGIC_LINK_TTL_MINUTES} minutes.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${c.canvas};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:${c.surface};border-radius:16px;overflow:hidden;">
        <tr><td style="background-color:${c.brand};padding:28px 32px;text-align:center;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#ffffff;">${escapeHtml(STORE_INFO.name)}</p>
        </td></tr>
        <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:${c.ink};">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${c.brandDeep};font-weight:bold;">Sign in</p>
          <h1 style="margin:0 0 16px;font-size:24px;color:${c.ink};">Hi ${firstName}, here's your link</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${c.inkMuted};">Tap the button to sign in to your account. The link works once and expires in ${MAGIC_LINK_TTL_MINUTES} minutes.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;"><tr><td style="background-color:${c.brand};border-radius:999px;">
            <a href="${url}" style="display:inline-block;padding:14px 36px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;">Sign in to my account</a>
          </td></tr></table>
          <p style="margin:0;font-size:13px;line-height:1.6;color:${c.inkMuted};">If you didn't request this, you can safely ignore it — nobody can sign in without the link. Button not working? Paste this into your browser:<br /><a href="${url}" style="color:${c.brandDeep};word-break:break-all;">${url}</a></p>
        </td></tr>
        <tr><td style="padding:20px 32px;background-color:${c.canvas};text-align:center;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${c.inkMuted};">${escapeHtml(STORE_INFO.name)} · ${escapeHtml(STORE_INFO.street)}, ${escapeHtml(STORE_INFO.city)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
