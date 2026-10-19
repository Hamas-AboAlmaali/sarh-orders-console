# Scaling memo: 5M orders, 3 developers, 2 countries

Measured first, on this code with 1,000,000 seeded orders (`pnpm db:seed --orders 1000000`). The
`orders` table takes 396 MB in total, indexes included (303 MB of the 396), and line items add
about two thirds as much again. At 5M orders that is roughly 2 GB for `orders` and 4 GB for the
whole database: one Postgres server still holds it comfortably in memory.

| Query (1M rows)                      | Time   | At 5M                          |
| ------------------------------------ | ------ | ------------------------------ |
| List page, any depth (keyset)        | 0.1 ms | Same: an index seek            |
| Same page with `OFFSET 500000`       | 162 ms | Grows with depth               |
| Search a surname (trigram)           | 17 ms  | ~85 ms                         |
| Stats: totals per status (full scan) | 37 ms  | ~0.2 s, on every Overview open |
| Stats: today (index range)           | 5 ms   | Same size per day              |
| Exact `COUNT(*)` for one status      | 153 ms | ~0.8 s                         |

## What I would change

1. **Make the country part of the data.** "Today" is hard-coded to `Asia/Riyadh`
   (`packages/shared/src/stats.ts`) and money is always SAR (`apps/web/src/lib/money.ts`). Add
   `country` and `currency` to orders and users. Compute "today" in each country's time zone, and
   never add up revenue across currencies.
2. **Cache stats on the server for 60 s.** Agents open Overview all day; caching means one 0.2 s
   scan per minute however many agents look. I would add a rollup table only if measurement shows
   the scan matters. It is more code to keep correct on every create, delete and status change.
3. **Fix the login limiter.** It counts per process and per IP (`auth.routes.ts`). Two offices
   behind NAT would each share 10 failures, and a second API instance would have its own counts.
   Key it per account, with a looser per-IP limit, in a Postgres-backed store. Postgres is already
   there; Redis would be one more system for three people to run.
4. **Write migrations for a live 2 GB table.** drizzle-kit generates `CREATE INDEX`, which blocks
   writes while it builds; write `CREATE INDEX CONCURRENTLY` by hand. Do backfills in batches, not
   as one `UPDATE`. Migration `0004` would have to be split this way.
5. **Purge idempotency keys** older than 7 days in a nightly job. One key per order adds up to 5M
   rows, and retries arrive within seconds, not days.
6. **Search:** require 3 characters (trigram indexes cannot help below that), and match an exact
   order id or email first, the way agents usually look up a caller.
7. **Make it observable:** `pg_stat_statements`, a slow-query log, and request logs that include
   the user and idempotency key. Today an error reaches only the console.

## What I would keep, deliberately

- **One API, one web app, one Postgres, one repository** with shared Zod schemas. With three
  developers, one change touches one pull request, and validation cannot drift between client and
  server.
- **Keyset pagination and the virtualised list.** Their cost does not grow with the table.
- **The idempotency design.** It relies on a primary key and a transaction, which do not change with
  table size.
- **Loading the user and role on every request.** It is one primary-key lookup, and removing or
  demoting a user takes effect on their next request, in both countries.
- **No partitioning, read replicas or search engine** until a measurement asks for one. 5M rows is
  small for Postgres.

## What I would refuse to build, even if asked

- **Exact totals on every filter** ("1–50 of 4,812,331"). Each one costs close to a second at 5M
  rows, repeated on every keystroke and filter change, for a number an agent looking for one order
  does not act on. I would offer Postgres' instant estimate ("about 4.8M") instead.
- **Bulk hard delete**, such as "delete all cancelled". It cannot be undone, and cancelled orders are
  still needed for refunds, chargebacks, tax audits and fraud checks. Instead: hide them, or archive
  them with a record of who did it and when.
- **Loading or exporting the whole table in the browser.** 5M rows would crash the tab, which is why
  R1 pages from the server. An export becomes a background job that produces a file to download.
- **A separate codebase or microservices per country.** Three developers would maintain two copies
  of every fix, and the copies would drift apart. If the law requires data to stay in each country,
  I would run the same code as two deployments. I would also refuse one database written from both
  regions: that is among the hardest problems in distributed systems, and it would reopen the
  duplicate orders R2 closes.
- **Optimistic order creation.** If an agent sees "created", hangs up, and the request then fails,
  the customer believes an order exists that does not. "Done" must mean the server has the order.
