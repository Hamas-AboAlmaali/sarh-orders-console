-- Trigram indexes back the substring search on customer name and email.
-- pg_trgm is a trusted extension (PostgreSQL 13+), so the database owner can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
