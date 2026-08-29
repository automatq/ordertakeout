import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Per-device staff sessions, against a real Postgres.
 *
 * The property worth proving is revocation: that marking a row revoked makes
 * exactly one outstanding token stop working, immediately, while every other
 * device keeps going. That cannot be shown with a mocked database — the whole
 * mechanism is a row lookup.
 *
 * Skipped unless TEST_DATABASE_URL is set, so the normal suite stays hermetic:
 *
 *   TEST_DATABASE_URL=postgresql://localhost:5432/ordertakeout_demo npm test
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

/** Labelled so a shared database's real rows are never touched. */
const LABEL = "__test__ device-session";

describeIfDb("per-device staff sessions", () => {
  let mod: typeof import("./device-session");
  let client: import("postgres").Sql;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.STORE_TIMEZONE ??= "America/Los_Angeles";
    process.env.STORE_CURRENCY ??= "CAD";
    process.env.SQUARE_ACCESS_TOKEN ??= "test";
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ??= "test";
    process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ??= "https://example.com/hook";
    process.env.STAFF_DASHBOARD_PASSWORD ??= "test-password";

    mod = await import("./device-session");
    const postgres = (await import("postgres")).default;
    client = postgres(TEST_DATABASE_URL!, { prepare: false });
    await cleanup();
  });

  afterAll(async () => {
    if (!TEST_DATABASE_URL) return;
    await cleanup();
    await client.end();
  });

  const cleanup = () => client`DELETE FROM staff_devices WHERE label LIKE ${LABEL + "%"}`;

  const register = (suffix = "") => mod.registerDevice(`${LABEL}${suffix}`, "ios");

  it("issues a token that verifies back to its own device", async () => {
    const device = await register(" a");
    await expect(mod.verifyDeviceToken(device.token)).resolves.toEqual({
      deviceId: device.deviceId,
    });
  });

  it("revoking one device leaves the others working", async () => {
    // The entire reason this table exists.
    const lost = await register(" lost");
    const counter = await register(" counter");

    expect(await mod.revokeDevice(lost.deviceId)).toBe(true);

    expect(await mod.verifyDeviceToken(lost.token)).toBeNull();
    await expect(mod.verifyDeviceToken(counter.token)).resolves.toEqual({
      deviceId: counter.deviceId,
    });
  });

  it("revoking twice reports that it already happened", async () => {
    const device = await register(" twice");
    expect(await mod.revokeDevice(device.deviceId)).toBe(true);
    // So a second press of the button does not claim to have done something.
    expect(await mod.revokeDevice(device.deviceId)).toBe(false);
  });

  it("gives each device a different secret", async () => {
    /* If two devices shared a key, one device's token would verify as the other
       and revoking either would be meaningless. */
    const [a, b] = await Promise.all([register(" k1"), register(" k2")]);
    const secrets = await client`
      SELECT secret FROM staff_devices WHERE id IN (${a.deviceId}, ${b.deviceId})`;
    expect(secrets).toHaveLength(2);
    expect(secrets[0]!.secret).not.toBe(secrets[1]!.secret);
  });

  it("refuses a token signed for a different device", async () => {
    const [a, b] = await Promise.all([register(" x1"), register(" x2")]);
    // Swap the device id but keep the signature.
    const [, expiry, signature] = a.token.split(".");
    expect(await mod.verifyDeviceToken(`${b.deviceId}.${expiry}.${signature}`)).toBeNull();
  });

  it("refuses a token whose expiry was edited", async () => {
    const device = await register(" tamper");
    const [id, expiry, signature] = device.token.split(".");
    const later = String(Number(expiry) + 60_000);
    /* The signature covers the expiry, so extending a token means forging the
       signature too — which needs the secret, which never left the server. */
    expect(await mod.verifyDeviceToken(`${id}.${later}.${signature}`)).toBeNull();
  });

  it("refuses an expired token even though the signature is genuine", async () => {
    const device = await mod.registerDevice(
      `${LABEL} old`,
      "ios",
      Date.now() - mod.DEVICE_TOKEN_TTL_MS - 60_000,
    );
    expect(await mod.verifyDeviceToken(device.token)).toBeNull();
  });

  it("refuses malformed tokens without touching the database", async () => {
    for (const token of [undefined, "", "nonsense", "a.b", "a.b.c.d"]) {
      expect(await mod.verifyDeviceToken(token)).toBeNull();
    }
  });

  it("refuses a token for a device row that no longer exists", async () => {
    const device = await register(" deleted");
    await client`DELETE FROM staff_devices WHERE id = ${device.deviceId}`;
    expect(await mod.verifyDeviceToken(device.token)).toBeNull();
  });

  it("lists revoked devices too, because that is the audit trail", async () => {
    const device = await register(" listed");
    await mod.revokeDevice(device.deviceId);

    const listed = (await mod.listStaffDevices()).find((row) => row.id === device.deviceId);
    expect(listed).toMatchObject({ label: `${LABEL} listed`, platform: "ios" });
    expect(listed?.revokedAt).toBeInstanceOf(Date);
  });

  it("only rewrites last-seen once it has gone stale", async () => {
    const device = await register(" seen");

    // Freshly registered, so nothing to do — this is the polling path.
    await mod.touchDevice(device.deviceId);
    const [untouched] = await client`
      SELECT last_seen_at FROM staff_devices WHERE id = ${device.deviceId}`;

    await client`
      UPDATE staff_devices SET last_seen_at = now() - interval '1 hour'
       WHERE id = ${device.deviceId}`;
    await mod.touchDevice(device.deviceId);

    const [touched] = await client`
      SELECT last_seen_at FROM staff_devices WHERE id = ${device.deviceId}`;
    expect(touched!.last_seen_at.getTime()).toBeGreaterThan(
      untouched!.last_seen_at.getTime() - 1000,
    );
  });
});
