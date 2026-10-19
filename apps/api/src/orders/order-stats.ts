import { BUSINESS_TIME_ZONE, ORDER_STATUSES, type OrderStats } from "@sarh/shared";
import { count, gte, ne, sql, sum } from "drizzle-orm";
import { db } from "../db/client";
import { orders } from "../db/schema";

const startOfBusinessDay = sql`date_trunc('day', now(), ${BUSINESS_TIME_ZONE})`;

/**
 * Totals per status and today's figures. "Today" is a range scan on the created_at index; the
 * per-status totals scan the whole table (about 17 ms at 50k rows), which grows linearly with it.
 */
export async function getOrderStats(): Promise<OrderStats> {
  const [statusRows, [todayRow]] = await Promise.all([
    db
      .select({
        status: orders.status,
        orderCount: count(),
        totalCents: sum(orders.totalCents).mapWith(Number),
      })
      .from(orders)
      .groupBy(orders.status),
    db
      .select({
        orderCount: count(),
        revenueCents:
          sql`coalesce(${sum(orders.totalCents)} filter (where ${ne(orders.status, "cancelled")}), 0)`.mapWith(
            Number,
          ),
      })
      .from(orders)
      .where(gte(orders.createdAt, startOfBusinessDay)),
  ]);

  const byStatus = new Map(statusRows.map((row) => [row.status, row]));
  return {
    byStatus: ORDER_STATUSES.map((status) => ({
      status,
      orderCount: byStatus.get(status)?.orderCount ?? 0,
      totalCents: byStatus.get(status)?.totalCents ?? 0,
    })),
    today: { orderCount: todayRow?.orderCount ?? 0, revenueCents: todayRow?.revenueCents ?? 0 },
    timeZone: BUSINESS_TIME_ZONE,
    generatedAt: new Date().toISOString(),
  };
}
