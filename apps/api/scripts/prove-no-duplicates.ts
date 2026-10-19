/**
 * Signs in as the seeded agent, fires the same create-order request N times in parallel against the
 * running API (one shared Idempotency-Key), then counts the resulting rows straight from the database.
 *
 *   pnpm prove:no-duplicates                # 2 parallel requests
 *   pnpm prove:no-duplicates --parallel 50
 */
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  type CreateOrderInput,
  type OrderDetail,
} from "@sarh/shared";
import { count, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { SESSION_COOKIE } from "../src/auth/session-token";
import { env } from "../src/config/env";
import { db, pool } from "../src/db/client";
import { orders } from "../src/db/schema";
import { SEED_USERS } from "../src/db/seed-data";

const { values } = parseArgs({
  options: {
    parallel: { type: "string", default: "2" },
    url: { type: "string", default: `http://localhost:${env.PORT}` },
  },
});
const parallel = Number(values.parallel);
if (!Number.isInteger(parallel) || parallel < 2) {
  throw new Error(`--parallel must be an integer of at least 2, got "${values.parallel}"`);
}

const idempotencyKey = randomUUID();
const order: CreateOrderInput = {
  customerName: "Idempotency Proof",
  customerEmail: `proof-${idempotencyKey}@example.test`,
  items: [{ productName: "Proof item", quantity: 1, unitPriceCents: 1_000 }],
  totalCents: 1_000,
};

/** Returns the `name=value` pair of the session cookie, ready for a Cookie header. */
async function signInAsAgent(): Promise<string> {
  const { email, password } = SEED_USERS.find((user) => user.role === "agent")!;
  const response = await fetch(`${values.url}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!response.ok || !cookie) {
    throw new Error(`Sign-in as ${email} failed with ${response.status}. Did you run db:seed?`);
  }
  return cookie.split(";")[0]!;
}

async function sendCreateRequest(attempt: number, sessionCookie: string) {
  const response = await fetch(`${values.url}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
      [IDEMPOTENCY_KEY_HEADER]: idempotencyKey,
    },
    body: JSON.stringify(order),
  });
  const body = (await response.json()) as Partial<OrderDetail>;
  return {
    request: attempt,
    status: response.status,
    orderId: body.id ?? "-",
    replayed: response.headers.get(IDEMPOTENT_REPLAY_HEADER) === "true",
  };
}

try {
  const sessionCookie = await signInAsAgent();
  console.log(`Firing ${parallel} identical POST /api/orders requests in parallel`);
  console.log(`${IDEMPOTENCY_KEY_HEADER}: ${idempotencyKey}\n`);

  const results = await Promise.all(
    Array.from({ length: parallel }, (_, index) => sendCreateRequest(index + 1, sessionCookie)),
  );
  console.table(results);

  const [row] = await db
    .select({ value: count() })
    .from(orders)
    .where(eq(orders.customerEmail, order.customerEmail));
  const created = row!.value;

  console.log(`\nOrders in the database for ${order.customerEmail}: ${created}`);
  if (created === 1) {
    console.log("PASS: exactly one order exists.");
  } else {
    console.error(`FAIL: expected exactly 1 order, found ${created}.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    error instanceof TypeError
      ? `Could not reach the API at ${values.url}. Is it running (pnpm dev)?`
      : error,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
