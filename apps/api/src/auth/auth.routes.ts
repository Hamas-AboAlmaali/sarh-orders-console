import { loginSchema, type SessionUser } from "@sarh/shared";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { db } from "../db/client";
import { users } from "../db/schema";
import { HttpError } from "../http/errors";
import { verifyAgainstDummyHash, verifyPassword } from "./password";
import { currentUser, requireAuth } from "./require-auth";
import { SESSION_COOKIE, sessionCookieOptions, signSessionToken } from "./session-token";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS_PER_WINDOW = 10;

/** A factory so each app instance gets its own rate-limit counters. */
export function createAuthRouter(): Router {
  const router = Router();

  const loginRateLimit = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: MAX_FAILED_LOGINS_PER_WINDOW,
    // Only failures count, so agents signing in normally never hit the limit.
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new HttpError(429, "too_many_attempts", "Too many failed sign-ins. Try again later.")),
  });

  router.post("/login", loginRateLimit, async (req, res) => {
    // Parsing rejects non-string fields, so a body like {"password": {"not": ""}} cannot reach the query.
    const { email, password } = loginSchema.parse(req.body);

    const [user] = await db.select().from(users).where(eq(users.email, email));
    const valid = user
      ? await verifyPassword(password, user.passwordHash)
      : await verifyAgainstDummyHash(password);
    if (!user || !valid) {
      throw new HttpError(401, "invalid_credentials", "Email or password is incorrect");
    }

    const sessionUser: SessionUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    res.cookie(SESSION_COOKIE, signSessionToken(user.id), sessionCookieOptions);
    res.json({ user: sessionUser });
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
    res.status(204).end();
  });

  router.get("/me", requireAuth, (req, res) => {
    res.json({ user: currentUser(req) });
  });

  return router;
}
