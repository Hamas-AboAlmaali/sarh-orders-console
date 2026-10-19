# Decisions

## 1. R2: idempotency key claimed in the same transaction as the order

The form sends one `Idempotency-Key` per intended order with every attempt (double-click, automatic
or manual retry). The server inserts the key `ON CONFLICT DO NOTHING` and writes the order in the
same transaction, so a concurrent duplicate waits on the key and then replays the stored order.
Another body or another user under the same key gets 422; a late retry for a deleted order gets 410.
**Rejected: detecting duplicates by content** (same customer and items within N minutes). It blocks
a customer who really orders the same thing twice and misses a retry that arrives after the window.
**Limits:** editing the order after a timeout makes a new key, and so possibly a second, different
order, which is intended. Keys are never purged yet.

## 2. Keyset pagination with a virtualised, infinitely scrolling list

The API returns 50 rows after an opaque cursor `(sort value, id)`, and the browser renders only the
visible rows. Each sort, with or without the status filter, has an index ending in `id`, so every
page is an index seek: 0.1 ms in the middle of 1M rows.
**Rejected: `OFFSET` with numbered pages.** It is simpler and gives "page 7 of 96", but it reads and
discards every skipped row (162 ms at offset 500k), and a new order shifts every page, so an agent
sees a row twice or misses one. Page numbers also need a `COUNT(*)` on every filter change.
**Cost:** no total count and no jumping to a page, which agents looking for one order rarely need.

## 3. TanStack Query owns all server state, keyed by the filters

Every request goes through TanStack Query. The list's query key is the complete filter object, and
each `queryFn` passes the `AbortSignal` to `fetch`. A response for old filters can only land in its
own cache entry, which the screen no longer reads, and is cancelled anyway.
**Rejected: hand-written `useEffect` + `AbortController` + a "latest request id" check.** It has no
dependency and nothing hidden, but the guard would be rewritten for the list, stats and session
screens, each a new chance to get it wrong, and it brings no cache for going back to a filter.
**Cost:** correctness rests on the library's semantics; `use-orders-list.test.tsx` pins them.

## Optional task: O1, not O2

O2 shows an order before the server confirms it. Where a duplicate is the worst outcome, that tells
the agent "done" too early, and an optimistic row has no correct place in a list that is sorted,
filtered and paginated on the server. O1 reuses R1's cancellation pattern, so it could be done well.

## AI use

I built this with Cursor's agent (Claude), phase by phase: setup and seed, R1, R2, auth, O1, docs.

- **What the AI did.** It wrote most of the code, the tests and the first drafts of these documents.
- **What I decided.** Before each phase it laid out the options and trade-offs. I made the choices,
  for example PostgreSQL over SQLite, Drizzle, infinite scroll over pages, O1 over O2, and tabs for
  navigation. I reviewed each phase and asked about anything I could not explain before moving on.
- **How the work was verified.** Every guarantee has a test, and each test was checked by
  temporarily removing the protection and watching the test fail. The flows were also exercised by
  hand in the browser.
- **What the AI got wrong, and was caught.** The item-count subquery bound `id` to the wrong table
  (every order showed 1 item); a test now compares against the database. A code comment claimed an
  index was used where `EXPLAIN` showed a sequential scan. An early estimate of the stats query at
  5M rows was about ten times too high; SCALE.md uses numbers measured on 1M rows instead.
