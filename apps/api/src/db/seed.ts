import { parseArgs } from "node:util";
import { pool } from "./client";
import { SEED_USERS, seedDatabase } from "./seed-data";

const DEFAULT_ORDER_COUNT = 50_000;

function parseOrderCount(): number {
  const { values } = parseArgs({ options: { orders: { type: "string" } } });
  if (values.orders === undefined) return DEFAULT_ORDER_COUNT;
  const count = Number(values.orders);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`--orders must be a positive integer, got "${values.orders}"`);
  }
  return count;
}

try {
  const orderCount = parseOrderCount();
  const startedAt = performance.now();
  await seedDatabase(orderCount, (inserted) => {
    process.stdout.write(
      `\rInserted ${inserted.toLocaleString()} / ${orderCount.toLocaleString()} orders`,
    );
  });
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\nSeeded ${SEED_USERS.length} users and ${orderCount.toLocaleString()} orders in ${seconds}s`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
