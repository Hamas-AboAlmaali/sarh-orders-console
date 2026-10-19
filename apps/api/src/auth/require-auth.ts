import type { SessionUser, UserRole } from "@sarh/shared";
import { eq } from "drizzle-orm";
import type { Request, RequestHandler } from "express";
import { db } from "../db/client";
import { users } from "../db/schema";
import { HttpError } from "../http/errors";
import { SESSION_COOKIE, verifySessionToken } from "./session-token";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express exposes Request only through this namespace.
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

const unauthenticated = () => new HttpError(401, "unauthenticated", "Sign in to continue");

async function findSessionUser(userId: number): Promise<SessionUser | undefined> {
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.id, userId));
  return user;
}

/** Accepts the session cookie only: tokens in URLs leak into logs, history and Referer headers. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const userId = typeof token === "string" ? verifySessionToken(token) : null;
  if (userId === null) throw unauthenticated();

  const user = await findSessionUser(userId);
  if (!user) throw unauthenticated();

  req.user = user;
  next();
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(currentUser(req).role)) {
      throw new HttpError(403, "forbidden", "You do not have permission to do this");
    }
    next();
  };
}

/** The authenticated user; only valid on routes behind requireAuth. */
export function currentUser(req: Request): SessionUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}
