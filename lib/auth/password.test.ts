import { describe, expect, it } from "vitest";

import { dummyHash, hashPassword, needsRehash, verifyPassword } from "./password";

describe("hashPassword", () => {
  /**
   * The regression that matters most here. Node's default maxmem is 32 MB and the
   * production parameters need slightly more, so scrypt throws
   * ERR_CRYPTO_INVALID_SCRYPT_PARAMS unless maxmem is set explicitly. Nothing
   * about the parameters looks wrong on the page; it only fails at runtime.
   */
  it("hashes at production parameters without exceeding node's default maxmem", async () => {
    await expect(hashPassword("correct horse battery staple")).resolves.toMatch(
      /^scrypt\$N=32768,r=8,p=1\$/,
    );
  });

  it("salts, so the same password never produces the same hash twice", async () => {
    const [first, second] = await Promise.all([hashPassword("hunter2"), hashPassword("hunter2")]);
    expect(first).not.toBe(second);
    await expect(verifyPassword("hunter2", first)).resolves.toBe(true);
    await expect(verifyPassword("hunter2", second)).resolves.toBe(true);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("flour and butter");
    await expect(verifyPassword("flour and butter", stored)).resolves.toBe(true);
    await expect(verifyPassword("flour and buttes", stored)).resolves.toBe(false);
  });

  it("rejects an empty password against a real hash", async () => {
    const stored = await hashPassword("something");
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  /* One corrupted row must not take sign-in down for everyone, so every one of
     these is a failed comparison rather than a thrown error. */
  it.each([
    ["empty", ""],
    ["not our format", "$2b$10$abcdefghijklmnopqrstuv"],
    ["too few fields", "scrypt$N=32768,r=8,p=1$onlysalt"],
    ["wrong prefix", "argon2$N=32768,r=8,p=1$c2FsdA$aGFzaA"],
    ["non-numeric params", "scrypt$N=abc,r=8,p=1$c2FsdA$aGFzaA"],
    ["empty salt", "scrypt$N=32768,r=8,p=1$$aGFzaA"],
    ["truncated", "scrypt$N=32768,r=8,p=1$c2FsdA$"],
  ])("returns false for a %s stored hash instead of throwing", async (_label, stored) => {
    await expect(verifyPassword("anything", stored)).resolves.toBe(false);
  });

  /* Verification reads the cost parameters out of the row, so an absurd stored N
     is a denial-of-service unless we refuse it: scaling maxmem to match would
     happily attempt a multi-gigabyte allocation for one sign-in attempt. */
  it("refuses stored parameters beyond the ceiling instead of honouring them", async () => {
    const started = Date.now();
    await expect(verifyPassword("x", "scrypt$N=1073741824,r=8,p=1$c2FsdA$aGFzaA")).resolves.toBe(
      false,
    );
    await expect(verifyPassword("x", "scrypt$N=32768,r=1024,p=1$c2FsdA$aGFzaA")).resolves.toBe(
      false,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("needsRehash", () => {
  it("is false for a hash written at current parameters", async () => {
    expect(needsRehash(await hashPassword("current"))).toBe(false);
  });

  it("is true for weaker parameters, so old hashes upgrade on next sign-in", () => {
    expect(needsRehash("scrypt$N=16384,r=8,p=1$c2FsdA$aGFzaA")).toBe(true);
  });

  it("is true for anything unparseable, so a corrupt row gets replaced", () => {
    expect(needsRehash("nonsense")).toBe(true);
  });
});

describe("dummyHash", () => {
  /* Sign-in must do the same work whether or not the account exists, or the
     response time tells an attacker which emails are real. */
  it("is a real verifiable hash that no password matches", async () => {
    const stored = await dummyHash();
    expect(stored).toMatch(/^scrypt\$/);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
    await expect(verifyPassword("guess", stored)).resolves.toBe(false);
  });

  it("is built once and reused", async () => {
    await expect(dummyHash()).resolves.toBe(await dummyHash());
  });
});
