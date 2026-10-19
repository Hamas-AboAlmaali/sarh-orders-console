import { IDEMPOTENCY_KEY_HEADER, type CreateOrderInput, type OrderDetail } from "@sarh/shared";
import { count, eq, like } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { SESSION_COOKIE } from "../src/auth/session-token";
import { env } from "../src/config/env";
import { db, pool } from "../src/db/client";
import { orders } from "../src/db/schema";
import { seedUser, signIn, type SignedInClient } from "./sign-in";

const app = createApp();
const EMAIL_DOMAIN = "auth.example.test";
let agent: SignedInClient;
let admin: SignedInClient;

beforeAll(async () => {
  [agent, admin] = await Promise.all([signIn(app, "agent"), signIn(app, "admin")]);
});

afterAll(async () => {
  await db.delete(orders).where(like(orders.customerEmail, `%@${EMAIL_DOMAIN}`));
  await pool.end();
});

function login(body: object, target = app) {
  return request(target).post("/api/auth/login").send(body);
}

function sessionCookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error("No session cookie was set");
  return cookie;
}

function tokenFrom(cookie: string): string {
  return cookie.split(";")[0]!.slice(SESSION_COOKIE.length + 1);
}

/** Calls a protected route presenting the given token as the session cookie. */
function withSessionToken(token: string) {
  return request(app).get("/api/orders").set("Cookie", `${SESSION_COOKIE}=${token}`);
}

async function validAgentClaims(): Promise<jwt.JwtPayload> {
  const { email, password } = seedUser("agent");
  const token = tokenFrom(sessionCookieFrom(await login({ email, password })));
  return jwt.decode(token) as jwt.JwtPayload;
}

async function createOrderAsAgent(): Promise<OrderDetail> {
  const order: CreateOrderInput = {
    customerName: "Auth Test",
    customerEmail: `${randomUUID()}@${EMAIL_DOMAIN}`,
    items: [{ productName: "Pen", quantity: 1, unitPriceCents: 100 }],
    totalCents: 100,
  };
  const response = await agent
    .post("/api/orders")
    .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
    .send(order)
    .expect(201);
  return response.body as OrderDetail;
}

async function orderExists(id: number): Promise<boolean> {
  const [row] = await db.select({ value: count() }).from(orders).where(eq(orders.id, id));
  return row!.value === 1;
}

describe("POST /api/auth/login", () => {
  it("sets an httpOnly, SameSite=Strict session cookie and returns the user without secrets", async () => {
    const { email, password, name } = seedUser("agent");

    const response = await login({ email: email.toUpperCase(), password });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: { id: expect.any(Number), email, name, role: "agent" },
    });
    const cookie = sessionCookieFrom(response);
    expect(cookie).toMatch(/; HttpOnly/);
    expect(cookie).toMatch(/; SameSite=Strict/);
    expect(cookie).toMatch(/; Path=\/api/);
    expect(cookie).toMatch(/; Max-Age=28800/);
  });

  it("signs tokens that expire", async () => {
    const claims = await validAgentClaims();

    expect(claims.exp! - claims.iat!).toBe(8 * 60 * 60);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrongPassword = await login({ email: seedUser("agent").email, password: "Wrong#2026" });
    const unknownEmail = await login({ email: "nobody@sarh.test", password: "Wrong#2026" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects non-string credentials instead of passing them to the query", async () => {
    const response = await login({ email: seedUser("admin").email, password: { not: "" } });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("locks out an address after ten failed attempts, even with the right password", async () => {
    const isolatedApp = createApp();
    const { email, password } = seedUser("agent");

    for (let attempt = 0; attempt < 10; attempt++) {
      await login({ email, password: "Wrong#2026" }, isolatedApp).expect(401);
    }
    const blocked = await login({ email, password }, isolatedApp);

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("too_many_attempts");
  });
});

describe("session checks on protected routes", () => {
  it("rejects a request without a session", async () => {
    const response = await request(app).get("/api/orders");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthenticated");
  });

  it("rejects a token signed with the old hard-coded secret", async () => {
    const claims = await validAgentClaims();
    const forged = jwt.sign(claims, "sarh-secret-2026", { algorithm: "HS256" });

    expect((await withSessionToken(forged)).status).toBe(401);
  });

  it("rejects an unsigned token (alg: none)", async () => {
    const claims = await validAgentClaims();
    const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString("base64url");
    const unsigned = `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.`;

    expect((await withSessionToken(unsigned)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const claims = await validAgentClaims();
    const expired = jwt.sign(
      { ...claims, exp: Math.floor(Date.now() / 1000) - 1 },
      env.JWT_SECRET,
      {
        algorithm: "HS256",
      },
    );

    expect((await withSessionToken(expired)).status).toBe(401);
  });

  it("rejects a valid token for a user that no longer exists", async () => {
    const claims = await validAgentClaims();
    const orphan = jwt.sign({ ...claims, sub: "999999" }, env.JWT_SECRET, { algorithm: "HS256" });

    expect((await withSessionToken(orphan)).status).toBe(401);
  });

  it("ignores a valid token sent in the query string or an Authorization header", async () => {
    const { email, password } = seedUser("agent");
    const token = tokenFrom(sessionCookieFrom(await login({ email, password })));

    const viaQuery = await request(app).get("/api/orders").query({ token });
    const viaHeader = await request(app).get("/api/orders").set("Authorization", `Bearer ${token}`);

    expect(viaQuery.status).toBe(401);
    expect(viaHeader.status).toBe(401);
    expect((await withSessionToken(token)).status).toBe(200);
  });

  it("returns the signed-in user from /api/auth/me", async () => {
    const response = await admin.get("/api/auth/me");

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ email: seedUser("admin").email, role: "admin" });
  });

  it("ends the session on logout", async () => {
    const client = await signIn(app, "agent");

    await client.post("/api/auth/logout").expect(204);

    expect((await client.get("/api/auth/me")).status).toBe(401);
  });
});

describe("DELETE /api/orders/:id", () => {
  it("is refused for an agent, whatever the UI shows", async () => {
    const order = await createOrderAsAgent();

    const response = await agent.delete(`/api/orders/${order.id}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("forbidden");
    expect(await orderExists(order.id)).toBe(true);
  });

  it("reads the role from the database, not from claims in the token", async () => {
    const order = await createOrderAsAgent();
    const claims = await validAgentClaims();
    const claimsAdmin = jwt.sign({ ...claims, role: "admin" }, env.JWT_SECRET, {
      algorithm: "HS256",
    });

    const response = await request(app)
      .delete(`/api/orders/${order.id}`)
      .set("Cookie", `${SESSION_COOKIE}=${claimsAdmin}`);

    expect(response.status).toBe(403);
    expect(await orderExists(order.id)).toBe(true);
  });

  it("deletes the order for an admin, and reports a missing order as not found", async () => {
    const order = await createOrderAsAgent();

    await admin.delete(`/api/orders/${order.id}`).expect(204);

    expect(await orderExists(order.id)).toBe(false);
    expect((await admin.delete(`/api/orders/${order.id}`)).status).toBe(404);
  });

  it("validates the id", async () => {
    const response = await admin.delete("/api/orders/not-a-number");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });
});
