import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { db, pool } from "../src/db/client";
import { seedDatabase } from "../src/db/seed-data";

// More than one seed batch, small enough to keep the suite fast.
const TEST_ORDER_COUNT = 1_500;

async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = "/postgres";

  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (!rowCount) {
      await client.query(`create database ${client.escapeIdentifier(name)}`);
    }
  } finally {
    await client.end();
  }
}

export async function setup(): Promise<void> {
  await ensureDatabaseExists(process.env.DATABASE_URL!);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedDatabase(TEST_ORDER_COUNT);
  await pool.end();
}
