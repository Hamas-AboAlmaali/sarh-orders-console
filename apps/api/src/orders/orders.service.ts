import type { ListOrdersQuery, OrderDetail, OrdersPage } from "@sarh/shared";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client";
import { orderItems, orders } from "../db/schema";
import { HttpError } from "../http/errors";
import { decodeCursor, encodeCursor, type OrderCursor } from "./cursor";

const sortColumns = {
  createdAt: orders.createdAt,
  totalCents: orders.totalCents,
} as const;

// Drizzle leaves columns unqualified in single-table queries; inside the subquery a bare "id"
// would bind to order_items.id, so the outer reference is qualified explicitly.
const itemCount = sql<number>`(
  select count(*)::int from ${orderItems}
  where ${orderItems.orderId} = ${orders}.${sql.identifier(orders.id.name)}
)`;

/** Escapes LIKE wildcards so user input is matched literally (backslash is Postgres' default escape). */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Keyset pagination: "rows strictly after (sortValue, id)" in the requested direction.
 * The row comparison matches the (sort column, id) indexes, so Postgres seeks instead of skipping rows.
 */
function afterCursor(cursor: OrderCursor): SQL {
  const operator = sql.raw(cursor.direction === "desc" ? "<" : ">");
  const value =
    cursor.sort === "createdAt" ? sql`${cursor.value}::timestamptz` : sql`${cursor.value}`;
  return sql`(${sortColumns[cursor.sort]}, ${orders.id}) ${operator} (${value}, ${cursor.id})`;
}

export async function listOrders(query: ListOrdersQuery): Promise<OrdersPage> {
  const conditions: (SQL | undefined)[] = [];

  if (query.status) {
    conditions.push(eq(orders.status, query.status));
  }
  if (query.search) {
    const pattern = `%${escapeLikePattern(query.search)}%`;
    conditions.push(or(ilike(orders.customerName, pattern), ilike(orders.customerEmail, pattern)));
  }
  if (query.cursor) {
    conditions.push(afterCursor(decodeCursor(query.cursor, query)));
  }

  const sortColumn = sortColumns[query.sort];
  const order = query.direction === "desc" ? desc : asc;

  const rows = await db
    .select({
      id: orders.id,
      customerName: orders.customerName,
      customerEmail: orders.customerEmail,
      status: orders.status,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
      itemCount,
    })
    .from(orders)
    .where(and(...conditions))
    .orderBy(order(sortColumn), order(orders.id))
    // One extra row tells us whether another page exists without a COUNT(*).
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    nextCursor: hasMore && last ? encodeCursor(cursorAt(last, query)) : null,
  };
}

export async function getOrderDetail(id: number): Promise<OrderDetail> {
  const [order] = await db
    .select({
      id: orders.id,
      customerName: orders.customerName,
      customerEmail: orders.customerEmail,
      status: orders.status,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.id, id));
  if (!order) {
    throw new HttpError(404, "order_not_found", "Order not found");
  }

  const items = await db
    .select({
      id: orderItems.id,
      productName: orderItems.productName,
      quantity: orderItems.quantity,
      unitPriceCents: orderItems.unitPriceCents,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, id))
    .orderBy(asc(orderItems.id));

  return { ...order, createdAt: order.createdAt.toISOString(), itemCount: items.length, items };
}

export async function deleteOrder(id: number): Promise<void> {
  const deleted = await db.delete(orders).where(eq(orders.id, id)).returning({ id: orders.id });
  if (deleted.length === 0) {
    throw new HttpError(404, "order_not_found", "Order not found");
  }
}

function cursorAt(
  row: { id: number; createdAt: Date; totalCents: number },
  { sort, direction }: ListOrdersQuery,
): OrderCursor {
  return sort === "createdAt"
    ? { sort, direction, value: row.createdAt.toISOString(), id: row.id }
    : { sort, direction, value: row.totalCents, id: row.id };
}
