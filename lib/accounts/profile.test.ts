import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: vi.fn(), resolvePhone: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/accounts/phone-sign-in", () => ({ resolvePhone: mocks.resolvePhone }));

const { createPhoneProfile, profileFieldsSchema, updateProfile } = await import("./profile");

const PHONE = "+14165550142";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";

const ROW = {
  id: ACCOUNT_ID,
  name: "Maria Santos",
  email: "maria@example.com",
  phone: PHONE,
  smsOptIn: false,
};

/** Every drizzle builder method returns the same thenable, so any shape resolves. */
function chain(result: unknown[]) {
  const proxy: unknown = new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      if (prop === "then") return (resolve: (value: unknown) => void) => resolve(result);
      return vi.fn(() => proxy);
    },
  });
  return proxy;
}

const FIELDS = { name: "Maria Santos", email: "Maria@Example.com ", phone: "416-555-0142" };

beforeEach(() => {
  mocks.db.mockReset();
  mocks.resolvePhone.mockReset();
  mocks.resolvePhone.mockResolvedValue({ kind: "none" });
});

describe("profileFieldsSchema", () => {
  it("normalizes a typed number to E.164 so a profile and an order agree", async () => {
    const parsed = profileFieldsSchema.parse(FIELDS);
    expect(parsed.phone).toBe(PHONE);
  });

  it("rejects a name of only whitespace and an unparseable number", () => {
    expect(profileFieldsSchema.safeParse({ ...FIELDS, name: "   " }).success).toBe(false);
    expect(profileFieldsSchema.safeParse({ ...FIELDS, phone: "nope" }).success).toBe(false);
  });
});

describe("createPhoneProfile", () => {
  it("lowercases the email before it is persisted", async () => {
    let stored: { email: string; phone: string } | undefined;
    mocks.db.mockReturnValue({
      insert: vi.fn(() => ({
        values: (v: typeof stored) => { stored = v; return chain([ROW]); },
      })),
    });

    const result = await createPhoneProfile({
      phone: PHONE,
      fields: profileFieldsSchema.parse(FIELDS),
    });

    expect(result.ok).toBe(true);
    expect(stored!.email).toBe("maria@example.com");
  });

  it("registers the verified number, not whatever the form said", async () => {
    let stored: { phone: string } | undefined;
    mocks.db.mockReturnValue({
      insert: vi.fn(() => ({
        values: (v: typeof stored) => { stored = v; return chain([ROW]); },
      })),
    });

    await createPhoneProfile({
      phone: PHONE,
      // A number the customer never proved they hold.
      fields: { ...profileFieldsSchema.parse(FIELDS), phone: "+14165559999" },
    });

    expect(stored!.phone).toBe(PHONE);
  });

  it("refuses a number that already has an account rather than adding a second", async () => {
    // A second account on one number makes both unreachable by phone sign-in.
    mocks.resolvePhone.mockResolvedValue({ kind: "account", account: ROW });
    const insert = vi.fn();
    mocks.db.mockReturnValue({ insert });

    const result = await createPhoneProfile({
      phone: PHONE,
      fields: profileFieldsSchema.parse(FIELDS),
    });

    expect(result).toEqual({ ok: false, message: expect.stringContaining("already has an account") });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses an already ambiguous number instead of adding a third account", async () => {
    mocks.resolvePhone.mockResolvedValue({ kind: "ambiguous" });
    const insert = vi.fn();
    mocks.db.mockReturnValue({ insert });

    expect((await createPhoneProfile({
      phone: PHONE,
      fields: profileFieldsSchema.parse(FIELDS),
    })).ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("reports a taken email when the unique index swallows the insert", async () => {
    // Two people finishing signup with one address both pass the read.
    mocks.db.mockReturnValue({ insert: vi.fn(() => chain([])) });

    const result = await createPhoneProfile({
      phone: PHONE,
      fields: profileFieldsSchema.parse(FIELDS),
    });

    expect(result).toEqual({ ok: false, message: expect.stringContaining("already has an account") });
  });
});

describe("updateProfile", () => {
  it("writes updatedAt, which nothing in the codebase ever did before", async () => {
    let written: { updatedAt?: Date } | undefined;
    mocks.db.mockReturnValue({
      select: vi.fn(() => chain([])),
      update: vi.fn(() => ({ set: (v: typeof written) => { written = v; return chain([ROW]); } })),
    });

    await updateProfile(ACCOUNT_ID, { name: "Maria S." });
    expect(written!.updatedAt).toBeInstanceOf(Date);
  });

  it("leaves absent fields alone rather than blanking them", async () => {
    let written: Record<string, unknown> | undefined;
    mocks.db.mockReturnValue({
      select: vi.fn(() => chain([])),
      update: vi.fn(() => ({ set: (v: Record<string, unknown>) => { written = v; return chain([ROW]); } })),
    });

    await updateProfile(ACCOUNT_ID, { smsOptIn: true });
    expect(written).toEqual({ smsOptIn: true, updatedAt: expect.any(Date) });
  });

  it("refuses an email that belongs to somebody else", async () => {
    mocks.db.mockReturnValue({
      select: vi.fn(() => chain([{ id: "00000000-0000-4000-8000-000000000002" }])),
      update: vi.fn(() => chain([ROW])),
    });

    const result = await updateProfile(ACCOUNT_ID, { email: "taken@example.com" });
    expect(result.ok).toBe(false);
  });

  it("survives losing the race to the unique index", async () => {
    /* The read is advisory. Postgres raises 23505 rather than returning
       nothing, so the loser has to be caught rather than reported as success. */
    mocks.db.mockReturnValue({
      select: vi.fn(() => chain([])),
      update: vi.fn(() => ({
        set: () => ({ where: () => ({ returning: () => Promise.reject(Object.assign(new Error("dup"), { code: "23505" })) }) }),
      })),
    });

    const result = await updateProfile(ACCOUNT_ID, { email: "taken@example.com" });
    expect(result).toEqual({ ok: false, message: expect.stringContaining("already has an account") });
  });

  it("lets any other database error through rather than blaming the email", async () => {
    mocks.db.mockReturnValue({
      select: vi.fn(() => chain([])),
      update: vi.fn(() => ({
        set: () => ({ where: () => ({ returning: () => Promise.reject(new Error("connection lost")) }) }),
      })),
    });

    await expect(updateProfile(ACCOUNT_ID, { name: "Maria S." })).rejects.toThrow("connection lost");
  });
});
