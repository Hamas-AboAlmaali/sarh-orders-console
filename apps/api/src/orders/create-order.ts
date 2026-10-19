import type { createOrderSchema, OrderDetail } from "@sarh/shared";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { z } from "zod";
import { db } from "../db/client";
import { idempotencyKeys, orderItems, orders } from "../db/schema";
import { HttpError } from "../http/errors";
import { getOrderDetail } from "./orders.service";

type NewOrder = z.output<typeof createOrderSchema>;

export type CreateOrderResult = { order: OrderDetail; replayed: boolean };

/**
 * Creates an order at most once per idempotency key, however many times the request arrives.
 *
 * The key is claimed and the order written in one transaction, and the key's primary key makes the
 * claim exclusive. When two requests race, Postgres makes the second INSERT wait for the first
 * transaction: if it commits, the second finds the key taken and replays the stored order; if it
 * rolls back, the second claims the key and creates the order itself.
 */
export async function createOrder(
  input: NewOrder,
  idempotencyKey: string,
  userId: number,
): Promise<CreateOrderResult> {
  // The parsed body is normalised (trimmed, lower-cased email, fixed key order), so equal orders hash equally.
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");

  const { orderId, replayed } = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .insert(idempotencyKeys)
      .values({ key: idempotencyKey, userId, requestHash })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (!claimed) {
      const [existing] = await tx
        .select({
          userId: idempotencyKeys.userId,
          requestHash: idempotencyKeys.requestHash,
          orderId: idempotencyKeys.orderId,
        })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey));

      // Another user's key gets the same answer as a mismatched body, so it reveals nothing about their order.
      if (existing?.userId !== userId || existing.requestHash !== requestHash) {
        throw new HttpError(
          422,
          "idempotency_key_reused",
          "This Idempotency-Key was already used for a different order",
        );
      }
      if (existing.orderId === null) {
        throw new HttpError(410, "order_deleted", "The order for this request has been deleted");
      }
      return { orderId: existing.orderId, replayed: true };
    }

    const [order] = await tx
      .insert(orders)
      .values({
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        totalCents: input.totalCents,
        createdBy: userId,
      })
      .returning({ id: orders.id });
    const newOrderId = order!.id;

    await tx
      .insert(orderItems)
      .values(input.items.map((item) => ({ ...item, orderId: newOrderId })));
    await tx
      .update(idempotencyKeys)
      .set({ orderId: newOrderId })
      .where(eq(idempotencyKeys.key, idempotencyKey));

    return { orderId: newOrderId, replayed: false };
  });

  return { order: await getOrderDetail(orderId), replayed };
}
