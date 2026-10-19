import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENT_REPLAY_HEADER,
  type CreateOrderInput,
  type OrderDetail,
} from "@sarh/shared";
import { count, eq, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { db, pool } from "../src/db/client";
import { idempotencyKeys, orders, users } from "../src/db/schema";
import { listen, seedUser, signIn, type SignedInClient } from "./sign-in";

const EMAIL_DOMAIN = "r2.example.test";
let server: Server;
let agent: SignedInClient;
let admin: SignedInClient;

beforeAll(async () => {
  server = await listen(createApp());
  [agent, admin] = await Promise.all([signIn(server, "agent"), signIn(server, "admin")]);
});

afterAll(async () => {
  server.close();
  await db.delete(orders).where(like(orders.customerEmail, `%@${EMAIL_DOMAIN}`));
  await pool.end();
});

/** A valid order with an email unique to this call, so each test can count its own rows. */
function newOrder(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    customerName: "Phone Order Customer",
    customerEmail: `${randomUUID()}@${EMAIL_DOMAIN}`,
    items: [
      { productName: "Desk lamp", quantity: 2, unitPriceCents: 4_500 },
      { productName: "Notebook", quantity: 1, unitPriceCents: 1_250 },
    ],
    totalCents: 10_250,
    ...overrides,
  };
}

function postOrder(body: unknown, key: string | null = randomUUID(), client = agent) {
  const req = client.post("/api/orders");
  if (key !== null) req.set(IDEMPOTENCY_KEY_HEADER, key);
  return req.send(body as object);
}

async function countOrdersFor(email: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(orders)
    .where(eq(orders.customerEmail, email));
  return row!.value;
}

describe("POST /api/orders", () => {
  it("creates the order with its line items", async () => {
    const order = newOrder();

    const response = await postOrder(order);

    expect(response.status).toBe(201);
    const created = response.body as OrderDetail;
    expect(created).toMatchObject({
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      status: "pending",
      totalCents: 10_250,
      itemCount: 2,
    });
    expect(
      created.items.map(({ productName, quantity, unitPriceCents }) => ({
        productName,
        quantity,
        unitPriceCents,
      })),
    ).toEqual(order.items);
    expect(response.headers[IDEMPOTENT_REPLAY_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("records which user created the order", async () => {
    const response = await postOrder(newOrder());

    const [row] = await db
      .select({ createdBy: users.email })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.createdBy))
      .where(eq(orders.id, (response.body as OrderDetail).id));
    expect(row?.createdBy).toBe(seedUser("agent").email);
  });

  describe("duplicate protection", () => {
    it("creates exactly one order when the same request is fired twice in parallel", async () => {
      const order = newOrder();
      const key = randomUUID();

      const responses = await Promise.all([postOrder(order, key), postOrder(order, key)]);

      expect(responses.map((response) => response.status)).toEqual([201, 201]);
      const [first, second] = responses.map((response) => response.body as OrderDetail);
      expect(second!.id).toBe(first!.id);
      const replays = responses.filter(
        (response) => response.headers[IDEMPOTENT_REPLAY_HEADER.toLowerCase()] === "true",
      );
      expect(replays).toHaveLength(1);
      expect(await countOrdersFor(order.customerEmail)).toBe(1);
    });

    it("still creates exactly one order under 20 concurrent retries", async () => {
      const order = newOrder();
      const key = randomUUID();

      const responses = await Promise.all(Array.from({ length: 20 }, () => postOrder(order, key)));

      expect(new Set(responses.map((response) => response.status))).toEqual(new Set([201]));
      expect(new Set(responses.map((response) => (response.body as OrderDetail).id)).size).toBe(1);
      expect(await countOrdersFor(order.customerEmail)).toBe(1);
      const [keys] = await db
        .select({ value: count() })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, key));
      expect(keys!.value).toBe(1);
    });

    it("replays the original order when a retry arrives after the first response", async () => {
      const order = newOrder();
      const key = randomUUID();

      const first = await postOrder(order, key);
      const retry = await postOrder(order, key);

      expect(retry.status).toBe(201);
      expect(retry.headers[IDEMPOTENT_REPLAY_HEADER.toLowerCase()]).toBe("true");
      expect(retry.body).toEqual(first.body);
      expect(await countOrdersFor(order.customerEmail)).toBe(1);
    });

    it("treats a retry with differently formatted but equivalent input as the same request", async () => {
      const order = newOrder();
      const key = randomUUID();

      await postOrder(order, key);
      const retry = await postOrder(
        {
          ...order,
          customerName: `  ${order.customerName} `,
          customerEmail: order.customerEmail.toUpperCase(),
        },
        key,
      );

      expect(retry.status).toBe(201);
      expect(retry.headers[IDEMPOTENT_REPLAY_HEADER.toLowerCase()]).toBe("true");
      expect(await countOrdersFor(order.customerEmail)).toBe(1);
    });

    it("rejects a key that was already used for a different order", async () => {
      const order = newOrder();
      const key = randomUUID();
      await postOrder(order, key);

      const reused = await postOrder({ ...order, customerName: "Someone Else" }, key);

      expect(reused.status).toBe(422);
      expect(reused.body.error.code).toBe("idempotency_key_reused");
      expect(await countOrdersFor(order.customerEmail)).toBe(1);
    });

    it("does not let another user replay a key, even with the same body", async () => {
      const order = newOrder();
      const key = randomUUID();
      await postOrder(order, key, agent);

      const fromAdmin = await postOrder(order, key, admin);

      expect(fromAdmin.status).toBe(422);
      expect(fromAdmin.body.error.code).toBe("idempotency_key_reused");
      expect(fromAdmin.body).not.toHaveProperty("id");
      expect(await countOrdersFor(order.customerEmail)).toBe(1);
    });

    it("does not recreate a deleted order when a late retry arrives", async () => {
      const order = newOrder();
      const key = randomUUID();
      const created = await postOrder(order, key);
      await admin.delete(`/api/orders/${(created.body as OrderDetail).id}`).expect(204);

      const lateRetry = await postOrder(order, key);

      expect(lateRetry.status).toBe(410);
      expect(lateRetry.body.error.code).toBe("order_deleted");
      expect(await countOrdersFor(order.customerEmail)).toBe(0);
    });

    it("creates separate orders for identical content sent with different keys", async () => {
      const order = newOrder();

      await postOrder(order, randomUUID());
      await postOrder(order, randomUUID());

      expect(await countOrdersFor(order.customerEmail)).toBe(2);
    });
  });

  describe("validation", () => {
    it.each([
      { key: null, reason: "is missing" },
      { key: "short", reason: "is too short" },
      { key: "has spaces in it, not allowed", reason: "contains invalid characters" },
    ])("rejects the request when the Idempotency-Key $reason", async ({ key }) => {
      const order = newOrder();

      const response = await postOrder(order, key);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("invalid_idempotency_key");
      expect(await countOrdersFor(order.customerEmail)).toBe(0);
    });

    it.each([
      {
        change: { totalCents: 9_999 },
        path: "totalCents",
        reason: "a total that does not match the items",
      },
      {
        change: { customerEmail: "not-an-email" },
        path: "customerEmail",
        reason: "an invalid email",
      },
      { change: { customerName: "   " }, path: "customerName", reason: "a blank customer name" },
      { change: { items: [], totalCents: 0 }, path: "items", reason: "no items" },
      {
        change: {
          items: Array.from({ length: 6 }, () => ({
            productName: "Pen",
            quantity: 1,
            unitPriceCents: 100,
          })),
          totalCents: 600,
        },
        path: "items",
        reason: "more than five items",
      },
      {
        change: {
          items: [{ productName: "Pen", quantity: 0, unitPriceCents: 100 }],
          totalCents: 0,
        },
        path: "items.0.quantity",
        reason: "a zero quantity",
      },
      {
        change: {
          items: [{ productName: "Pen", quantity: 1.5, unitPriceCents: 100 }],
          totalCents: 150,
        },
        path: "items.0.quantity",
        reason: "a fractional quantity",
      },
    ] satisfies { change: Partial<CreateOrderInput>; path: string; reason: string }[])(
      "rejects $reason",
      async ({ change, path }) => {
        const order = newOrder(change);

        const response = await postOrder(order);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe("validation_error");
        expect(response.body.error.issues.map((issue: { path: string }) => issue.path)).toContain(
          path,
        );
        expect(await countOrdersFor(order.customerEmail)).toBe(0);
      },
    );

    it("rejects a body that is not JSON", async () => {
      const response = await agent
        .post("/api/orders")
        .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
        .set("Content-Type", "application/json")
        .send("{not json");

      expect(response.status).toBe(400);
    });
  });
});
