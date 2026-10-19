import { faker } from "@faker-js/faker";
import {
  MAX_ITEMS_PER_ORDER,
  MIN_ITEMS_PER_ORDER,
  sumLineItems,
  type OrderStatus,
} from "@sarh/shared";
import { sql } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { db } from "./client";
import { idempotencyKeys, orderItems, orders, users } from "./schema";

const BATCH_SIZE = 1_000;
const CUSTOMER_POOL_SIZE = 8_000;
const HISTORY_DAYS = 365;

// Credentials are intentionally public: they are documented in the README for reviewers.
export const SEED_USERS = [
  { email: "admin@sarh.test", name: "Admin User", role: "admin", password: "Admin#2026" },
  { email: "agent@sarh.test", name: "Agent User", role: "agent", password: "Agent#2026" },
] as const;

const STATUS_WEIGHTS: { value: OrderStatus; weight: number }[] = [
  { value: "delivered", weight: 45 },
  { value: "shipped", weight: 15 },
  { value: "paid", weight: 15 },
  { value: "pending", weight: 15 },
  { value: "cancelled", weight: 10 },
];

type OrderRow = typeof orders.$inferInsert & { id: number };
type OrderItemRow = typeof orderItems.$inferInsert;
type Customer = { name: string; email: string };

function buildCustomerPool(): Customer[] {
  return Array.from({ length: CUSTOMER_POOL_SIZE }, () => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    return {
      name: `${firstName} ${lastName}`,
      email: faker.internet.email({ firstName, lastName }).toLowerCase(),
    };
  });
}

function buildOrder(id: number, customer: Customer): { order: OrderRow; items: OrderItemRow[] } {
  const itemCount = faker.number.int({ min: MIN_ITEMS_PER_ORDER, max: MAX_ITEMS_PER_ORDER });
  const items: OrderItemRow[] = Array.from({ length: itemCount }, () => ({
    orderId: id,
    productName: faker.commerce.productName(),
    quantity: faker.number.int({ min: 1, max: 3 }),
    unitPriceCents: faker.number.int({ min: 500, max: 50_000 }),
  }));

  return {
    order: {
      id,
      customerName: customer.name,
      customerEmail: customer.email,
      status: faker.helpers.weightedArrayElement(STATUS_WEIGHTS),
      totalCents: sumLineItems(items),
      createdAt: faker.date.recent({ days: HISTORY_DAYS }),
    },
    items,
  };
}

/** Wipes users and orders, then inserts the seed users and `orderCount` deterministic orders. */
export async function seedDatabase(
  orderCount: number,
  onProgress?: (inserted: number) => void,
): Promise<void> {
  faker.seed(2026);
  const customers = buildCustomerPool();
  const userRows = await Promise.all(
    SEED_USERS.map(async ({ password, ...user }) => ({
      ...user,
      passwordHash: await hashPassword(password),
    })),
  );

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`truncate table ${idempotencyKeys}, ${orderItems}, ${orders}, ${users} restart identity`,
    );
    await tx.insert(users).values(userRows);

    for (let firstId = 1; firstId <= orderCount; firstId += BATCH_SIZE) {
      const lastId = Math.min(firstId + BATCH_SIZE - 1, orderCount);
      const batch = Array.from({ length: lastId - firstId + 1 }, (_, offset) =>
        buildOrder(firstId + offset, faker.helpers.arrayElement(customers)),
      );

      // Ids are assigned here so items can reference their order without relying on RETURNING order.
      await tx
        .insert(orders)
        .overridingSystemValue()
        .values(batch.map(({ order }) => order));
      await tx.insert(orderItems).values(batch.flatMap(({ items }) => items));
      onProgress?.(lastId);
    }

    await tx.execute(sql`select setval(pg_get_serial_sequence('orders', 'id'), ${orderCount})`);
  });
  // Without VACUUM, the freshly loaded GIN indexes keep a pending list the planner prices too high,
  // so search falls back to a sequential scan until autovacuum happens to run.
  await db.execute(sql`vacuum analyze ${orders}, ${orderItems}`);
}
