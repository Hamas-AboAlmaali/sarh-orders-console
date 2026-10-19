import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// OWASP minimum for scrypt: N=2^17, r=8, p=1. Needs ~128 MiB, above Node's 32 MiB default.
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;
const MAX_MEMORY = 256 * 1024 * 1024;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { ...options, maxmem: MAX_MEMORY }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Format: `scrypt$N$r$p$salt$key` (base64), so parameters can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = storedHash.split("$");
  if (scheme !== "scrypt" || !N || !r || !p || !salt || !key) return false;

  const expected = Buffer.from(key, "base64");
  const actual = await deriveKey(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same time as a real check, for logins with an unknown email, so response times do not
 * reveal which emails have accounts. Always resolves to false.
 */
export async function verifyAgainstDummyHash(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await dummyHash);
  return false;
}
