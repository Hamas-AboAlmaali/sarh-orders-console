ALTER TABLE "idempotency_keys" DROP CONSTRAINT "idempotency_keys_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD COLUMN "user_id" bigint;--> statement-breakpoint
-- Keys claimed before sign-in existed cannot be attributed to a user. Their orders stay; only the
-- replay record goes, and an unauthenticated retry of those requests is now rejected anyway.
DELETE FROM "idempotency_keys" WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "created_by" bigint;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_created_by_idx" ON "orders" USING btree ("created_by") WHERE "orders"."created_by" is not null;