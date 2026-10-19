import type { UserRole } from "@sarh/shared";
import type { Express } from "express";
import { once } from "node:events";
import type { Server } from "node:http";
import request from "supertest";
import { SEED_USERS } from "../src/db/seed-data";

export type SignedInClient = ReturnType<typeof request.agent>;

export function seedUser(role: UserRole) {
  const user = SEED_USERS.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`No seed user with role ${role}`);
  return user;
}

/**
 * For tests that fire many requests at once: given an app that is not listening yet, supertest
 * starts a server and attaches listeners for every request queued while it starts.
 */
export async function listen(app: Express): Promise<Server> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

/** A supertest agent that keeps the session cookie of the seeded user with this role. */
export async function signIn(app: Express | Server, role: UserRole): Promise<SignedInClient> {
  const { email, password } = seedUser(role);
  const client = request.agent(app);
  const response = await client.post("/api/auth/login").send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Sign-in as ${role} failed with ${response.status}`);
  }
  return client;
}
