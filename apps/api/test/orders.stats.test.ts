import {
  IDEMPOTENCY_KEY_HEADER,
  ORDER_STATUSES,
  type CreateOrderInput,
  type OrderDetail,
  type OrderStats,
} from "@sarh/shared";
import express from "express";
import { eq, like, sql } from "drizzle-orm";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { db, pool } from "../src/db/client";
import { orders } from "../src/db/schema";
import { clientDisconnectSignal } from "../src/http/client-disconnect";
import { randomStatsDelayMs } from "../src/orders/orders.routes";
import { signIn, type SignedInClient } from "./sign-in";

const app = createApp({ statsDelayMs: () => 0 });
const EMAIL_DOMAIN = "stats.example.test";
let agent: SignedInClient;

beforeAll(async () => {
  agent = await signIn(app, "agent");
});

afterAll(async () => {
  await db.delete(orders).where(like(orders.customerEmail, `%@${EMAIL_DOMAIN}`));
  await pool.end();
});

async function getStats(): Promise<OrderStats> {
  const response = await agent.get("/api/orders/stats").expect(200);
  return response.body as OrderStats;
}

async function createOrder(totalCents: number): Promise<OrderDetail> {
  const order: CreateOrderInput = {
    customerName: "Stats Test",
    customerEmail: `${randomUUID()}@${EMAIL_DOMAIN}`,
    items: [{ productName: "Pen", quantity: 1, unitPriceCents: totalCents }],
    totalCents,
  };
  const response = await agent
    .post("/api/orders")
    .set(IDEMPOTENCY_KEY_HEADER, randomUUID())
    .send(order)
    .expect(201);
  return response.body as OrderDetail;
}

describe("GET /api/orders/stats", () => {
  it("requires a session", async () => {
    expect((await request(app).get("/api/orders/stats")).status).toBe(401);
  });

  it("totals every status, in a stable order, matching the database", async () => {
    const stats = await getStats();

    const expected = await db.execute<{ status: string; order_count: number; total: string }>(
      sql`select status, count(*)::int as order_count, sum(total_cents) as total from orders group by status`,
    );
    expect(stats.byStatus.map((row) => row.status)).toEqual([...ORDER_STATUSES]);
    for (const row of expected.rows) {
      expect(stats.byStatus.find((entry) => entry.status === row.status)).toEqual({
        status: row.status,
        orderCount: row.order_count,
        totalCents: Number(row.total),
      });
    }
  });

  it("counts an order created now as today's revenue until it is cancelled", async () => {
    const before = await getStats();

    const order = await createOrder(12_345);
    const afterCreate = await getStats();
    await db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id));
    const afterCancel = await getStats();

    expect(afterCreate.today.orderCount).toBe(before.today.orderCount + 1);
    expect(afterCreate.today.revenueCents).toBe(before.today.revenueCents + 12_345);
    expect(afterCancel.today.orderCount).toBe(before.today.orderCount + 1);
    expect(afterCancel.today.revenueCents).toBe(before.today.revenueCents);
    expect(afterCancel.timeZone).toBe("Asia/Riyadh");
  });

  it("waits for the configured delay before answering", async () => {
    const slowApp = createApp({ statsDelayMs: () => 400 });
    const client = await signIn(slowApp, "agent");

    const startedAt = performance.now();
    await client.get("/api/orders/stats").expect(200);

    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(400);
  });

  it("uses a production delay between three and six seconds", () => {
    const delays = Array.from({ length: 1_000 }, randomStatsDelayMs);

    expect(Math.min(...delays)).toBeGreaterThanOrEqual(3_000);
    expect(Math.max(...delays)).toBeLessThanOrEqual(6_000);
  });
});

describe("clientDisconnectSignal", () => {
  async function serve(handler: express.RequestHandler) {
    const server = express().get("/", handler).listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    return { server, url: `http://localhost:${(server.address() as AddressInfo).port}/` };
  }

  it("aborts when the client cancels before the response is sent", async () => {
    let resolveAborted: (aborted: boolean) => void;
    const aborted = new Promise<boolean>((resolve) => (resolveAborted = resolve));
    const { server, url } = await serve((_req, res) => {
      const signal = clientDisconnectSignal(res);
      signal.addEventListener("abort", () => resolveAborted(true));
    });

    const controller = new AbortController();
    const pending = fetch(url, { signal: controller.signal }).catch(() => undefined);
    setTimeout(() => controller.abort(), 50);
    await pending;

    expect(await aborted).toBe(true);
    server.close();
  });

  it("does not abort once the response has been sent", async () => {
    let signal: AbortSignal | undefined;
    const { server, url } = await serve((_req, res) => {
      signal = clientDisconnectSignal(res);
      res.json({ ok: true });
    });

    await fetch(url).then((response) => response.json());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(signal?.aborted).toBe(false);
    server.close();
  });
});
