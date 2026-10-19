import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required to run the tests (see .env.example)");
}
if (testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL: the tests wipe their database");
}
// Set before anything imports src/config/env, so the app under test only ever sees the test database.
process.env.DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Test files share one database; run them one at a time so fixtures cannot interfere.
    fileParallelism: false,
  },
});
