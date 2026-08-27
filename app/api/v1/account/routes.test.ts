import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestPhoneCode: vi.fn(),
  verifyPhoneCode: vi.fn(),
  listAccountOrders: vi.fn(),
  serverEnv: vi.fn(() => ({ CUSTOMER_ACCOUNT_SECRET: "account-secret" })),
}));

vi.mock("@/lib/accounts/phone-auth", () => ({
  requestPhoneCode: mocks.requestPhoneCode,
  verifyPhoneCode: mocks.verifyPhoneCode,
}));
vi.mock("@/lib/accounts/orders", () => ({ listAccountOrders: mocks.listAccountOrders }));
vi.mock("@/lib/env", () => ({ serverEnv: mocks.serverEnv }));

const { POST: requestCode } = await import("./code/route");
const { POST: openSession } = await import("./session/route");
const { GET: history } = await import("./orders/route");
const { createAccountSessionToken } = await import("@/lib/accounts/session");

const ACCOUNT = "6c93cabb-de1e-41ff-bd63-708825ca6ab8";
const SENT = "If that number has an account with us, a 6-digit code is on its way. It expires in 10 minutes.";

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
