import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: mocks.db }));

import {
  MAX_CODE_ATTEMPTS,
  PHONE_CODE_LENGTH,
  codeMatchesHash,
  consumePhoneSignInCode,
  issuePhoneSignInCode,
} from "./phone-sign-in";

const NOW = new Date("2026-08-23T12:00:00Z");
const ACCOUNT = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Maria Santos",
  phone: "+14165550142",
};
const SECOND_ACCOUNT = { ...ACCOUNT, id: "00000000-0000-4000-8000-000000000002" };

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

beforeEach(() => {
  mocks.db.mockReset();
});

describe("issuePhoneSignInCode", () => {
  it("mints a zero-padded code of the advertised length", async () => {
    const insert = vi.fn(() => chain([]));
    mocks.db.mockReturnValue({
      select: vi.fn().mockReturnValueOnce(chain([ACCOUNT])).mockReturnValueOnce(chain([{ value: 0 }])),
      insert,
    });

    const issued = await issuePhoneSignInCode("416-555-0142", NOW);
    expect(issued).not.toBeNull();
    expect(issued!.code).toMatch(new RegExp(`^\\d{${PHONE_CODE_LENGTH}}$`));
    expect(issued!.account.id).toBe(ACCOUNT.id);
    expect(insert).toHaveBeenCalledOnce();
  });

  it("stores only a salted hash, never the code", async () => {
    let stored: { codeHash: string } | undefined;
    mocks.db.mockReturnValue({
      select: vi.fn().mockReturnValueOnce(chain([ACCOUNT])).mockReturnValueOnce(chain([{ value: 0 }])),
      insert: vi.fn(() => ({ values: (v: { codeHash: string }) => { stored = v; return chain([]); } })),
    });

    const issued = await issuePhoneSignInCode("+14165550142", NOW);
    expect(stored!.codeHash).not.toContain(issued!.code);
    expect(codeMatchesHash(ACCOUNT.id, issued!.code, stored!.codeHash)).toBe(true);
    // Salted per account: the same digits for someone else hash differently.
    expect(codeMatchesHash(SECOND_ACCOUNT.id, issued!.code, stored!.codeHash)).toBe(false);
  });

  it("returns null for an unknown number — callers must answer identically", async () => {
    mocks.db.mockReturnValue({ select: vi.fn(() => chain([])) });
    expect(await issuePhoneSignInCode("+14165550199", NOW)).toBeNull();
  });

  it("refuses a number shared by two accounts rather than guessing one", async () => {
    // customer_accounts.phone is deliberately not unique. Picking a winner
    // would hand one household member another's order history.
    mocks.db.mockReturnValue({ select: vi.fn(() => chain([ACCOUNT, SECOND_ACCOUNT])) });
    expect(await issuePhoneSignInCode("+14165550142", NOW)).toBeNull();
  });

  it("returns null for an unparseable number without touching the database", async () => {
    mocks.db.mockReturnValue({ select: vi.fn(() => chain([ACCOUNT])) });
    expect(await issuePhoneSignInCode("nonsense", NOW)).toBeNull();
  });

  it("refuses to mint past the outstanding-code cap", async () => {
    const insert = vi.fn();
    mocks.db.mockReturnValue({
      select: vi.fn().mockReturnValueOnce(chain([ACCOUNT])).mockReturnValueOnce(chain([{ value: 3 }])),
      insert,
    });
    expect(await issuePhoneSignInCode("+14165550142", NOW)).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("consumePhoneSignInCode", () => {
  it("opens a session when the atomic update claims a row", async () => {
    mocks.db.mockReturnValue({
      select: vi.fn(() => chain([ACCOUNT])),
      update: vi.fn(() => chain([{ accountId: ACCOUNT.id }])),
    });
    expect(await consumePhoneSignInCode("+14165550142", "123456", NOW)).toEqual({
      accountId: ACCOUNT.id,
    });
  });

  it("burns an attempt on every live code when the guess misses", async () => {
    // Requesting three codes must buy three codes, not 3x the guesses.
    const update = vi.fn().mockReturnValueOnce(chain([])).mockReturnValueOnce(chain([]));
    mocks.db.mockReturnValue({ select: vi.fn(() => chain([ACCOUNT])), update });

    expect(await consumePhoneSignInCode("+14165550142", "999999", NOW)).toBeNull();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed codes before any query", async () => {
    const select = vi.fn(() => chain([ACCOUNT]));
    mocks.db.mockReturnValue({ select, update: vi.fn(() => chain([])) });

    for (const bad of ["", "12345", "1234567", "12345a", " 12 34 "]) {
      expect(await consumePhoneSignInCode("+14165550142", bad, NOW)).toBeNull();
    }
    expect(select).not.toHaveBeenCalled();
  });

  it("refuses an ambiguous number on the verify path too", async () => {
    const update = vi.fn(() => chain([{ accountId: ACCOUNT.id }]));
    mocks.db.mockReturnValue({ select: vi.fn(() => chain([ACCOUNT, SECOND_ACCOUNT])), update });
    expect(await consumePhoneSignInCode("+14165550142", "123456", NOW)).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("caps guesses low enough that six digits cannot be brute-forced", () => {
    // 1,000,000 possibilities against a handful of tries is the whole defence.
    expect(MAX_CODE_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
