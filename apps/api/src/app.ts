import cookieParser from "cookie-parser";
import express from "express";
import { createAuthRouter } from "./auth/auth.routes";
import { requireAuth } from "./auth/require-auth";
import { errorHandler, notFoundHandler } from "./http/errors";
import { createOrdersRouter, type OrdersRouterOptions } from "./orders/orders.routes";

export function createApp(options: OrdersRouterOptions = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.use("/api/auth", createAuthRouter());
  app.use("/api/orders", requireAuth, createOrdersRouter(options));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
