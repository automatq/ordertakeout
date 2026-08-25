import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  issueMagicLink: vi.fn(),
  sendMagicLinkEmail: vi.fn(),
  issuePhoneSignInCode: vi.fn(),
  sendPhoneSignInCode: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

/* `after` deliberately does NOT invoke its callback. That is what makes this a
   real regression test: if the action ever goes back to awaiting the send
   inline, the send spy fires during the call and these tests fail. */
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/accounts/magic-link", () => ({
  issueMagicLink: mocks.issueMagicLink,
  consumeMagicLink: vi.fn(),
}));
vi.mock("@/lib/accounts/magic-link-email", () => ({ sendMagicLinkEmail: mocks.sendMagicLinkEmail }));
vi.mock("@/lib/accounts/phone-sign-in", () => ({
  issuePhoneSignInCode: mocks.issuePhoneSignInCode,
  consumePhoneSignInCode: vi.fn(),
}));
vi.mock("@/lib/accounts/phone-sign-in-sms", () => ({ sendPhoneSignInCode: mocks.sendPhoneSignInCode }));
vi.mock("@/lib/accounts/session", () => ({ setAccountSession: vi.fn() }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ STORE_PUBLIC_URL: "https://harinabakeshoppe.com" }) }));
vi.mock("@/lib/security/rate-limit", () => ({
  consumeRateLimit: mocks.consumeRateLimit,
  requestFingerprint: async () => "203.0.113.7",
}));

import { requestPhoneSignInCode, requestSignInLink } from "./sign-in";

const ACCOUNT = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "maria@example.com",
  name: "Maria Santos",
  phone: "+14165550142",
};

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
});

describe("sign-in enumeration safety", () => {
  it("never awaits the email send, so response time is not an oracle", async () => {
    // Regression: the send used to be awaited only when the account existed, so
    // a registered address cost a Resend round-trip (~200ms) and an unknown one
    // returned immediately — trivially measurable from a JSON client.
    mocks.issueMagicLink.mockResolvedValue({ token: "tok", account: ACCOUNT });

    const result = await requestSignInLink(form({ email: ACCOUNT.email }));

    expect(result.ok).toBe(true);
    expect(mocks.sendMagicLinkEmail).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("returns an identical response for a known and an unknown email", async () => {
    mocks.issueMagicLink.mockResolvedValue({ token: "tok", account: ACCOUNT });
    const known = await requestSignInLink(form({ email: ACCOUNT.email }));

    mocks.issueMagicLink.mockResolvedValue(null);
    const unknown = await requestSignInLink(form({ email: "nobody@example.com" }));

    expect(known).toEqual(unknown);
    // The unknown branch must also do no work after the lookup.
    expect(mocks.sendMagicLinkEmail).not.toHaveBeenCalled();
  });

  it("never awaits the SMS send either", async () => {
    mocks.issuePhoneSignInCode.mockResolvedValue({ code: "123456", account: ACCOUNT });

    const result = await requestPhoneSignInCode(form({ phone: "416-555-0142" }));

    expect(result.ok).toBe(true);
    expect(mocks.sendPhoneSignInCode).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("returns an identical response for a known and an unknown number", async () => {
    mocks.issuePhoneSignInCode.mockResolvedValue({ code: "123456", account: ACCOUNT });
    const known = await requestPhoneSignInCode(form({ phone: "416-555-0142" }));

    mocks.issuePhoneSignInCode.mockResolvedValue(null);
    const unknown = await requestPhoneSignInCode(form({ phone: "416-555-0199" }));

    expect(known).toEqual(unknown);
  });

  it("still schedules a send that actually delivers when invoked", async () => {
    // after() defers the call; it must not swallow it.
    mocks.issueMagicLink.mockResolvedValue({ token: "tok", account: ACCOUNT });
    await requestSignInLink(form({ email: ACCOUNT.email }));

    const scheduled = mocks.after.mock.calls[0]![0] as () => unknown;
    await scheduled();

    expect(mocks.sendMagicLinkEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ACCOUNT.email, name: ACCOUNT.name }),
    );
  });
});
