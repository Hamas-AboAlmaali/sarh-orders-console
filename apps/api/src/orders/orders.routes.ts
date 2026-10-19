import { createOrderSchema, IDEMPOTENT_REPLAY_HEADER, listOrdersQuerySchema } from "@sarh/shared";
import { Router } from "express";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { currentUser, requireRole } from "../auth/require-auth";
import { clientDisconnectSignal } from "../http/client-disconnect";
import { requireIdempotencyKey } from "../http/idempotency-key";
import { createOrder } from "./create-order";
import { getOrderStats } from "./order-stats";
import { deleteOrder, listOrders } from "./orders.service";

const orderIdParamsSchema = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .max(2 ** 53 - 1),
});

export type OrdersRouterOptions = {
  /** Artificial latency of the stats endpoint, which the brief requires to take 3–6 seconds. */
  statsDelayMs?: () => number;
};

export function randomStatsDelayMs(): number {
  return 3_000 + Math.floor(Math.random() * 3_001);
}

/** Mounted behind requireAuth. */
export function createOrdersRouter({
  statsDelayMs = randomStatsDelayMs,
}: OrdersRouterOptions = {}): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const query = listOrdersQuerySchema.parse(req.query);
    res.json(await listOrders(query));
  });

  router.get("/stats", async (_req, res) => {
    const disconnected = clientDisconnectSignal(res);
    try {
      await delay(statsDelayMs(), undefined, { signal: disconnected });
    } catch (error) {
      // Nobody is waiting for the answer any more, so skip the database work entirely.
      if (disconnected.aborted) return;
      throw error;
    }
    res.json(await getOrderStats());
  });

  router.post("/", async (req, res) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const input = createOrderSchema.parse(req.body);

    const { order, replayed } = await createOrder(input, idempotencyKey, currentUser(req).id);

    // A replay returns the original status and body; the header only marks it for debugging.
    if (replayed) res.setHeader(IDEMPOTENT_REPLAY_HEADER, "true");
    res.status(201).json(order);
  });

  router.delete("/:id", requireRole("admin"), async (req, res) => {
    const { id } = orderIdParamsSchema.parse(req.params);
    await deleteOrder(id);
    res.status(204).end();
  });

  return router;
}
