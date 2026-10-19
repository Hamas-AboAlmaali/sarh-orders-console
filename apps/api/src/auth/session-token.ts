import type { CookieOptions } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const SESSION_COOKIE = "sarh_session";

// One working shift. There are no refresh tokens, so this is also the longest a stolen cookie works.
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const ALGORITHM = "HS256";
const ISSUER = "sarh-orders-api";
const AUDIENCE = "sarh-orders-console";

/**
 * The token carries only the user id. Role and account state are read from the database on every
 * request, so a demoted or deleted user loses access immediately instead of when the token expires.
 */
export function signSessionToken(userId: number): string {
  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    subject: String(userId),
    expiresIn: SESSION_TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/** Returns the user id of a valid, unexpired token signed by this server, otherwise null. */
export function verifySessionToken(token: string): number | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === "string" || !payload.sub || !/^[1-9]\d*$/.test(payload.sub)) return null;
    return Number(payload.sub);
  } catch {
    return null;
  }
}

export const sessionCookieOptions: CookieOptions = {
  // Not readable from JavaScript, so an XSS payload cannot exfiltrate the token.
  httpOnly: true,
  // Never attached to requests started by another site, which is the CSRF defence.
  sameSite: "strict",
  secure: env.NODE_ENV === "production",
  path: "/api",
  maxAge: SESSION_TTL_SECONDS * 1000,
};
