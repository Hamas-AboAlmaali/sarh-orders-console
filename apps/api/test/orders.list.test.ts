import type { ListOrdersParams, OrderSummary, OrdersPage } from "@sarh/shared";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { db, pool } from "../src/db/client";
import { orders } from "../src/db/schema";
import { signIn, type SignedInClient } from "./sign-in";

const app = createApp();
let client: SignedInClient;

beforeAll(async () => {
  client = await signIn(app, "agent");
});

afterAll(async () => {
  await pool.end();
});

async function getPage(params: ListOrdersParams) {
  return client.get("/api/orders").query(params);
}

/** Follows nextCursor until the end and returns every row in the order the API served it. */
async function fetchAllPages(params: ListOrdersParams): Promise<OrderSummary[]> {
  const rows: OrderSummary[] = [];
  let cursor: string | undefined;
  do {
    const response = await getPage({ ...params, ...(cursor && { cursor }) });
    expect(response.status).toBe(200);
    const page = response.body as OrdersPage;
    rows.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return rows;
}

describe("GET /api/orders", () => {
  it("returns the first page newest first, with a cursor for the next one", async () => {
    const response = await getPage({});

    expect(response.status).toBe(200);
    const page = response.body as OrdersPage;
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toEqual(expect.any(String));

    const timestamps = page.items.map((order) => Date.parse(order.createdAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("reports each order's real number of line items", async () => {
    const { items } = (await getPage({ limit: 100 })).body as OrdersPage;

    const counts = await db.execute<{ order_id: string; count: number }>(
      sql`select order_id, count(*)::int as count from order_items
          where order_id in ${items.map((order) => order.id)} group by order_id`,
    );
    const expected = new Map(counts.rows.map((row) => [Number(row.order_id), row.count]));
    expect(new Set(items.map((order) => order.itemCount)).size).toBeGreaterThan(1);
    for (const order of items) {
      expect(order.itemCount).toBe(expected.get(order.id));
    }
  });

  it.each([
    { sort: "createdAt", direction: "desc", column: "created_at" },
    { sort: "createdAt", direction: "asc", column: "created_at" },
    { sort: "totalCents", direction: "desc", column: "total_cents" },
    { sort: "totalCents", direction: "asc", column: "total_cents" },
  ] as const)(
    "serves every matching order exactly once, in order, when paging by $sort $direction",
    async ({ sort, direction, column }) => {
      const served = await fetchAllPages({ status: "cancelled", sort, direction, limit: 37 });

      const expected = await db.execute<{ id: string }>(
        sql`select id from orders where status = 'cancelled'
            order by ${sql.identifier(column)} ${sql.raw(direction)}, id ${sql.raw(direction)}`,
      );
      expect(served.map((order) => order.id)).toEqual(expected.rows.map((row) => Number(row.id)));
    },
  );

  it("keeps a stable order across pages when sort values tie", async () => {
    const createdAt = new Date("2026-01-01T12:00:00.000Z");
    const inserted = await db
      .insert(orders)
      .values(
        Array.from({ length: 7 }, () => ({
          customerName: "Tie Breaker",
          customerEmail: "tie@example.test",
          totalCents: 1_000,
          createdAt,
        })),
      )
      .returning({ id: orders.id });
    const ids = inserted.map((row) => row.id);

    try {
      for (const sort of ["createdAt", "totalCents"] as const) {
        const served = await fetchAllPages({ search: "Tie Breaker", sort, limit: 3 });
        expect(served.map((order) => order.id)).toEqual([...ids].sort((a, b) => b - a));
      }
    } finally {
      await db.delete(orders).where(inArray(orders.id, ids));
    }
  });

  it("searches name and email case-insensitively", async () => {
    const [sample] = await db.select({ name: orders.customerName }).from(orders).limit(1);
    const lastName = sample!.name.split(" ").at(-1)!;
    const term = lastName.slice(0, 4).toUpperCase();

    const served = await fetchAllPages({ search: term, limit: 100 });

    const expected = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from orders
          where customer_name ilike ${`%${term}%`} or customer_email ilike ${`%${term}%`}`,
    );
    expect(served.length).toBeGreaterThan(0);
    expect(served).toHaveLength(expected.rows[0]!.count);
    for (const order of served) {
      const haystack = `${order.customerName} ${order.customerEmail}`.toLowerCase();
      expect(haystack).toContain(term.toLowerCase());
    }
  });

  it.each(["%", "\\"])("treats %s in the search term literally", async (term) => {
    const response = await getPage({ search: term });

    expect(response.status).toBe(200);
    expect((response.body as OrdersPage).items).toEqual([]);
  });

  it("treats _ as a literal underscore, not a single-character wildcard", async () => {
    const response = await getPage({ search: "_" });

    const { items } = response.body as OrdersPage;
    expect(items.length).toBeGreaterThan(0);
    for (const order of items) {
      expect(`${order.customerName}${order.customerEmail}`).toContain("_");
    }
  });

  it.each([
    { params: { status: "lost" }, reason: "an unknown status" },
    { params: { sort: "customerName" }, reason: "an unsupported sort field" },
    { params: { limit: "500" }, reason: "a page size above the maximum" },
  ])("rejects $reason with a validation error", async ({ params }) => {
    const response = await client.get("/api/orders").query(params);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
  });

  it("rejects a cursor that is not one the API issued", async () => {
    const response = await getPage({ cursor: "not-a-real-cursor" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_cursor");
  });

  it("rejects a cursor replayed against a different sort", async () => {
    const first = await getPage({ sort: "createdAt" });
    const { nextCursor } = first.body as OrdersPage;

    const response = await getPage({ sort: "totalCents", cursor: nextCursor! });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_cursor");
  });
});
