import { createApp } from "./app";
import { env } from "./config/env";
import { pool } from "./db/client";

const server = createApp().listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

function shutdown(): void {
  server.close(() => void pool.end());
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
