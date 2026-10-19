import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../config/env";
import * as schema from "./schema";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle({ client: pool, schema });
