import { ORDER_STATUSES, USER_ROLES } from "@sarh/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", USER_ROLES);
export const orderStatus = pgEnum("order_status", ORDER_STATUSES);

// Millisecond precision so a timestamp survives the round trip through a JS Date,
// which keyset-pagination cursors depend on.
const createdAt = () =>
  timestamp("created_at", { withTimezone: true, precision: 3, mode: "date" })
    .notNull()
    .defaultNow();

export const users = pgTable("users", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  // Stored lower-cased by the application.
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRole("role").notNull(),
  createdAt: createdAt(),
});

export const orders = pgTable(
  "orders",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    status: orderStatus("status").notNull().default("pending"),
    // Money is stored in integer minor units to avoid floating-point drift.
    totalCents: integer("total_cents").notNull(),
    // Null for seeded orders, which stand in for history imported from before the console existed.
    createdBy: bigint("created_by", { mode: "number" }).references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    check("orders_total_cents_non_negative", sql`${t.totalCents} >= 0`),
    index("orders_created_by_idx")
      .on(t.createdBy)
      .where(sql`${t.createdBy} is not null`),
    // One index per sortable column, with id as the tie-breaker the cursor needs.
    // Postgres scans these backwards for descending sorts.
    index("orders_created_at_id_idx").on(t.createdAt, t.id),
    index("orders_total_cents_id_idx").on(t.totalCents, t.id),
    index("orders_status_created_at_id_idx").on(t.status, t.createdAt, t.id),
    index("orders_status_total_cents_id_idx").on(t.status, t.totalCents, t.id),
    // Trigram indexes serve substring search (ILIKE '%term%') on name and email.
    index("orders_customer_name_trgm_idx").using("gin", t.customerName.op("gin_trgm_ops")),
    index("orders_customer_email_trgm_idx").using("gin", t.customerEmail.op("gin_trgm_ops")),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    userId: bigint("user_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 of the normalised request body, to reject a key reused for a different order.
    requestHash: text("request_hash").notNull(),
    // Set in the same transaction that claims the key. Once committed, null means the order was
    // deleted; the key survives so a late retry cannot recreate it.
    orderId: bigint("order_id", { mode: "number" }).references(() => orders.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  // Lets deleting an order find its key without scanning the table.
  (t) => [index("idempotency_keys_order_id_idx").on(t.orderId)],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    orderId: bigint("order_id", { mode: "number" })
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
  },
  (t) => [
    check("order_items_quantity_positive", sql`${t.quantity} > 0`),
    check("order_items_unit_price_non_negative", sql`${t.unitPriceCents} >= 0`),
    index("order_items_order_id_idx").on(t.orderId),
  ],
);
