import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Password hashing for named staff accounts.
 *
 * `scrypt` from node:crypto rather than bcrypt or argon2, for two reasons. It is
 * memory-hard (unlike PBKDF2), RFC 7914, and on OWASP's accepted list — so it is
 * a real answer, not a convenient one. And this repo has no password-hashing
 * dependency and a consistent preference for standard-library primitives; the
 * alternatives are native modules that would add per-platform binaries to a
 * serverless bundle for no security we are missing.
 *
 * Note this is a genuine KDF, unlike the single keyed HMAC in lib/staff/roster.ts
 * that hashes refund PINs. That one is adequate for a 4-digit code behind an
 * already-authenticated session; a password is a different problem.
 *
 * The stored string carries its own parameters, so they can be raised later and
 * old hashes upgraded on next sign-in rather than invalidated:
 *
 *   scrypt$N=32768,r=8,p=1$<salt base64url>$<hash base64url>
 */

/* Hand-wrapped rather than promisify()d: promisify collapses scrypt's overloads
   and loses the options argument, which is where maxmem lives. */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });
}

const N = 32_768;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;

/**
 * Node's default `maxmem` is 32 MB, and N=32768 with r=8 needs a shade more, so
 * scrypt throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS without this. It is the single
 * most likely way this module ships broken — the parameters look conservative
 * and the failure only appears at runtime — so the test suite pins it.
 */
const MAX_MEM = 128 * N * R * 2;

const PREFIX = "scrypt";

function encode(salt: Buffer, hash: Buffer): string {
  return [
    PREFIX,
    `N=${N},r=${R},p=${P}`,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

interface Parsed {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

/**
 * The most expensive stored parameters we are willing to honour.
 *
 * Verification reads N, r and p from the row, so without a ceiling a corrupted or
 * hostile value turns one sign-in attempt into an enormous allocation that runs
 * for minutes — scaling `maxmem` to match the stored N does not protect us, it
 * *removes* the protection. These are generous next to the current parameters
 * (N=32768, r=8) and still bound the work to well under a second.
 */
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;

/** Returns null rather than throwing: a corrupt row must not 500 the sign-in page. */
function parse(stored: string): Parsed | null {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;

  const params = new Map(
    parts[1]!.split(",").map((pair) => {
      const [key, value] = pair.split("=");
      return [key ?? "", Number(value)] as const;
    }),
  );
  const n = params.get("N");
  const r = params.get("r");
  const p = params.get("p");
  if (!n || !r || !p || !Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return null;
  }
  if (n > MAX_N || r > MAX_R || p > MAX_P) return null;

  try {
    const salt = Buffer.from(parts[2]!, "base64url");
    const hash = Buffer.from(parts[3]!, "base64url");
    if (salt.length === 0 || hash.length === 0) return null;
    return { n, r, p, salt, hash };
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEM });
  return encode(salt, hash);
}

/**
 * Constant-time where it matters, and false rather than a throw where it does not.
 *
 * A malformed stored hash is treated as a failed comparison, not an error: the
 * alternative is that one corrupted row takes down sign-in for everybody.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;

  let candidate: Buffer;
  try {
    candidate = await scrypt(password, parsed.salt, parsed.hash.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: 128 * parsed.n * parsed.r * 2,
    });
  } catch {
    /* Stored parameters we cannot honour — absurd N, or one that exceeds maxmem.
       Same answer as a wrong password, and never an exception the caller has to
       distinguish from one. */
    return false;
  }

  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

/** True when `stored` was written with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return parsed.n < N || parsed.r < R || parsed.p < P;
}

/**
 * A hash of a value nobody knows, for the no-such-user branch of sign-in.
 *
 * Looking a user up and only then hashing makes a missing account return far
 * faster than a wrong password, which is an account-enumeration oracle. Verify
 * against this instead so both paths do the same work. Built once at module load
 * because the point is the comparison cost, not the value.
 */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummy;
}
