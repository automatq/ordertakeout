import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestPhoneCode: vi.fn(),
  verifyPhoneCode: vi.fn(),
  listAccountOrders: vi.fn(),
  loyaltyBalance: vi.fn(),
  loyaltyLedger: vi.fn(),
  getProfile: vi.fn(),
  createPhoneProfile: vi.fn(),
  updateProfile: vi.fn(),
  serverEnv: vi.fn(() => ({ CUSTOMER_ACCOUNT_SECRET: "account-secret" })),
}));

vi.mock("@/lib/accounts/phone-auth", () => ({
  requestPhoneCode: mocks.requestPhoneCode,
  verifyPhoneCode: mocks.verifyPhoneCode,
}));
vi.mock("@/lib/accounts/orders", () => ({ listAccountOrders: mocks.listAccountOrders }));
vi.mock("@/lib/accounts/profile", async () => ({
  ...(await vi.importActual<typeof import("@/lib/accounts/profile")>("@/lib/accounts/profile")),
  getProfile: mocks.getProfile,
  createPhoneProfile: mocks.createPhoneProfile,
  updateProfile: mocks.updateProfile,
}));
vi.mock("@/lib/accounts/loyalty", () => ({
  loyaltyBalance: mocks.loyaltyBalance,
  loyaltyLedger: mocks.loyaltyLedger,
  REWARD_POINTS: 100,
  REWARD_DISCOUNT_CENTS: 1_000,
}));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));

const { POST: requestCode } = await import("./code/route");
const { POST: openSession } = await import("./session/route");
const { GET: history } = await import("./orders/route");
const { GET: rewards } = await import("./rewards/route");
const {
  GET: profile,
  POST: createProfile,
  PATCH: patchProfile,
} = await import("./profile/route");
const { createSignupToken } = await import("@/lib/accounts/signup-token");
const { accountIdFromSession, createAccountSessionToken } = await import("@/lib/accounts/session");

const ACCOUNT = "6c93cabb-de1e-41ff-bd63-708825ca6ab8";
const SENT = "A 6-digit code is on its way. It expires in 10 minutes.";
const PHONE = "+14165550142";
const PROFILE = {
  name: "Maria Santos",
  email: "maria@example.com",
  phone: PHONE,
  smsOptIn: false,
};

const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body?: unknown,
) =>
  handler(
    new Request(`http://localhost/api/v1/account/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

beforeEach(() => {
  mocks.requestPhoneCode.mockReset();
  mocks.requestPhoneCode.mockResolvedValue({ ok: true, message: SENT });
  mocks.verifyPhoneCode.mockReset();
  mocks.verifyPhoneCode.mockResolvedValue({ ok: true, accountId: ACCOUNT });
  mocks.listAccountOrders.mockReset();
  mocks.listAccountOrders.mockResolvedValue([]);
  mocks.loyaltyBalance.mockReset();
  mocks.loyaltyBalance.mockResolvedValue(0);
  mocks.loyaltyLedger.mockReset();
  mocks.loyaltyLedger.mockResolvedValue([]);
  mocks.getProfile.mockReset();
  mocks.getProfile.mockResolvedValue(PROFILE);
  mocks.createPhoneProfile.mockReset();
  mocks.createPhoneProfile.mockResolvedValue({ ok: true, accountId: ACCOUNT, profile: PROFILE });
  mocks.updateProfile.mockReset();
  mocks.updateProfile.mockResolvedValue({ ok: true, accountId: ACCOUNT, profile: PROFILE });
});

describe("POST /api/v1/account/code", () => {
  it("passes the body through to the shared sign-in path", async () => {
    // Every enumeration-safety property lives there, and is tested there.
    await post(requestCode, "code", { phone: "+15550000000" });
    expect(mocks.requestPhoneCode).toHaveBeenCalledWith({ phone: "+15550000000" });
  });

  it("reports a refusal as something to read, not an error to branch on", async () => {
    /* Rate limiting and a malformed number are both sentences for the screen.
       A 4xx would invite the client to treat them differently, and the whole
       point is that the caller cannot tell these cases apart. */
    mocks.requestPhoneCode.mockResolvedValue({ ok: false, message: "Too many code requests." });
    const response = await post(requestCode, "code", { phone: "nope" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { sent: false, message: "Too many code requests." },
    });
  });

  it("rejects a body that is not JSON", async () => {
    expect((await post(requestCode, "code")).status).toBe(400);
  });
});

describe("POST /api/v1/account/session", () => {
  it("returns a token the history route accepts", async () => {
    const { data } = await (await post(openSession, "session", { phone: "+1", code: "123456" })).json();
    expect(data.signedIn).toBe(true);

    mocks.listAccountOrders.mockResolvedValue([]);
    const response = await history(
      new Request("http://localhost/api/v1/account/orders", {
        headers: { authorization: `Bearer ${data.token}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.listAccountOrders).toHaveBeenCalledWith(ACCOUNT);
  });

  it("gives one message for a wrong code and an expired one", async () => {
    // Telling somebody guessing that they are close is telling them too much.
    mocks.verifyPhoneCode.mockResolvedValue({
      ok: false,
      message: "That code is wrong or has expired. Request a new one and try again.",
    });
    const { data } = await (await post(openSession, "session", { phone: "+1", code: "000000" })).json();
    expect(data).toEqual({
      signedIn: false,
      message: "That code is wrong or has expired. Request a new one and try again.",
    });
    expect(data.token).toBeUndefined();
  });
});

describe("GET /api/v1/account/orders", () => {
  const get = (authorization?: string) =>
    history(
      new Request("http://localhost/api/v1/account/orders", {
        headers: authorization ? { authorization } : {},
      }),
    );

  it("refuses every flavour of missing or bad token identically", async () => {
    const expired = await createAccountSessionToken(ACCOUNT, Date.now() - 400 * 24 * 60 * 60_000);
    const responses = await Promise.all([
      get(),
      get(""),
      get("Basic abc"),
      get("Bearer"),
      get(`Bearer ${ACCOUNT}.9999999999999.forged`),
      get(`Bearer ${expired}`),
    ]);
    const bodies = await Promise.all(responses.map((r) => r.text()));
    expect(new Set(bodies).size).toBe(1);
    expect(new Set(responses.map((r) => r.status))).toEqual(new Set([401]));
    // A history is worth more to somebody who should not have it than one order is.
    expect(mocks.listAccountOrders).not.toHaveBeenCalled();
  });

  it("returns only what a customer needs to recognise their own orders", async () => {
    mocks.listAccountOrders.mockResolvedValue([
      {
        id: "order-1",
        orderNumber: "PT-ABC123",
        status: "paid",
        pickupDate: "2026-08-26",
        pickupTime: "16:00:00",
        totalCents: 5000,
        currency: "CAD",
        pickupLocationName: "Harina — Wilson",
        items: [{ name: "Ensaymada tray", quantity: 2 }],
      },
    ]);

    const { data } = await (await get(`Bearer ${await createAccountSessionToken(ACCOUNT)}`)).json();
    expect(data.orders[0]).toEqual({
      orderNumber: "PT-ABC123",
      status: "paid",
      pickupDate: "2026-08-26",
      // HH:mm on the wire, whatever shape the column came back in.
      pickupTime: "16:00",
      totalCents: 5000,
      currency: "CAD",
      pickupLocationName: "Harina — Wilson",
      items: [{ name: "Ensaymada tray", quantity: 2 }],
    });
    // The internal row id is not a thing a customer has any use for.
    expect(JSON.stringify(data)).not.toContain("order-1");
    /* Regression: the history rendered every row as "Today" because each order's
       date was compared against itself. */
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("GET /api/v1/account/rewards", () => {
  const get = (authorization?: string) =>
    rewards(
      new Request("http://localhost/api/v1/account/rewards", {
        headers: authorization ? { authorization } : {},
      }),
    );

  it("refuses every flavour of missing or bad token identically", async () => {
    const expired = await createAccountSessionToken(ACCOUNT, Date.now() - 400 * 24 * 60 * 60_000);
    const responses = await Promise.all([
      get(),
      get(""),
      get("Basic abc"),
      get("Bearer"),
      get(`Bearer ${ACCOUNT}.9999999999999.forged`),
      get(`Bearer ${expired}`),
    ]);
    const bodies = await Promise.all(responses.map((r) => r.text()));
    expect(new Set(bodies).size).toBe(1);
    expect(new Set(responses.map((r) => r.status))).toEqual(new Set([401]));
    // A balance is a fact about a named person's spending. Never read it first.
    expect(mocks.loyaltyBalance).not.toHaveBeenCalled();
  });

  it("sends the thresholds with the balance, so the app never hardcodes them", async () => {
    mocks.loyaltyBalance.mockResolvedValue(40);

    const { data } = await (await get(`Bearer ${await createAccountSessionToken(ACCOUNT)}`)).json();
    expect(data).toMatchObject({ points: 40, rewardPoints: 100, rewardDiscountCents: 1_000 });
  });

  it("names the order each entry moved on, and dates it on the wire", async () => {
    mocks.loyaltyLedger.mockResolvedValue([
      {
        id: "entry-1",
        kind: "earned",
        points: 45,
        orderNumber: "PT-ABC123",
        createdAt: new Date("2026-08-26T14:00:00.000Z"),
      },
    ]);

    const { data } = await (await get(`Bearer ${await createAccountSessionToken(ACCOUNT)}`)).json();
    expect(data.entries).toEqual([
      {
        id: "entry-1",
        kind: "earned",
        points: 45,
        orderNumber: "PT-ABC123",
        createdAt: "2026-08-26T14:00:00.000Z",
      },
    ]);
  });
});

describe("GET /api/v1/account/profile", () => {
  const get = (authorization?: string) =>
    profile(
      new Request("http://localhost/api/v1/account/profile", {
        headers: authorization ? { authorization } : {},
      }),
    );

  it("refuses every flavour of missing or bad token identically", async () => {
    const expired = await createAccountSessionToken(ACCOUNT, Date.now() - 400 * 24 * 60 * 60_000);
    const responses = await Promise.all([
      get(), get(""), get("Basic abc"), get("Bearer"),
      get(`Bearer ${ACCOUNT}.9999999999999.forged`), get(`Bearer ${expired}`),
    ]);
    const bodies = await Promise.all(responses.map((r) => r.text()));
    expect(new Set(bodies).size).toBe(1);
    expect(new Set(responses.map((r) => r.status))).toEqual(new Set([401]));
    expect(mocks.getProfile).not.toHaveBeenCalled();
  });

  it("returns the details checkout fills itself in with, and nothing else", async () => {
    const { data } = await (await get(`Bearer ${await createAccountSessionToken(ACCOUNT)}`)).json();
    // .strict() on the DTO is what keeps a new column off every phone.
    expect(data).toEqual(PROFILE);
  });
});

describe("POST /api/v1/account/profile", () => {
  const post = (body: unknown) =>
    createProfile(
      new Request("http://localhost/api/v1/account/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  const FIELDS = { name: "Maria Santos", email: "maria@example.com", phone: PHONE };

  it("refuses a forged, absent or expired signup token before touching the fields", async () => {
    for (const signupToken of [undefined, "", "nonsense", `${PHONE}.9999999999999.forged`]) {
      const response = await post({ ...FIELDS, signupToken });
      expect(response.status).toBe(400);
    }
    expect(mocks.createPhoneProfile).not.toHaveBeenCalled();
  });

  it("registers the number the token attests to, not the one in the body", async () => {
    await post({
      ...FIELDS,
      phone: "+14165559999",
      signupToken: await createSignupToken(PHONE),
    });
    expect(mocks.createPhoneProfile).toHaveBeenCalledWith(
      expect.objectContaining({ phone: PHONE }),
    );
  });

  it("returns a session so the app is signed in the moment the profile exists", async () => {
    const response = await post({ ...FIELDS, signupToken: await createSignupToken(PHONE) });
    const { data } = await response.json();
    expect(data).toMatchObject(PROFILE);
    expect(await accountIdFromSession(data.token)).toBe(ACCOUNT);
  });

  it("passes a refusal through as a 400 rather than a session", async () => {
    mocks.createPhoneProfile.mockResolvedValue({ ok: false, message: "That email already has an account." });
    const response = await post({ ...FIELDS, signupToken: await createSignupToken(PHONE) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "That email already has an account." },
    });
  });
});

describe("PATCH /api/v1/account/profile", () => {
  const patch = (body: unknown, authorization?: string) =>
    patchProfile(
      new Request("http://localhost/api/v1/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        body: JSON.stringify(body),
      }),
    );

  it("needs a session", async () => {
    expect((await patch({ name: "Maria S." })).status).toBe(401);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("edits only the fields it was given", async () => {
    await patch({ smsOptIn: true }, `Bearer ${await createAccountSessionToken(ACCOUNT)}`);
    expect(mocks.updateProfile).toHaveBeenCalledWith(ACCOUNT, { smsOptIn: true });
  });

  it("normalizes a typed number before it reaches the database", async () => {
    await patch({ phone: "416-555-0142" }, `Bearer ${await createAccountSessionToken(ACCOUNT)}`);
    expect(mocks.updateProfile).toHaveBeenCalledWith(ACCOUNT, { phone: PHONE });
  });

  it("rejects an invalid email with the message meant for the customer", async () => {
    const response = await patch(
      { email: "not-an-email" },
      `Bearer ${await createAccountSessionToken(ACCOUNT)}`,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Please enter a valid email address" },
    });
  });
});
