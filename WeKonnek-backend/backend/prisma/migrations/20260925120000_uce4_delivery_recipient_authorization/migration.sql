-- UCE-4: alternate delivery recipient authorization.
-- Customer-self delivery does not insert a row.
-- Does not alter commerce, payment, Rider Advance, Stage 9, or Stage 12.

CREATE TYPE "DeliveryRecipientCategory" AS ENUM (
  'HOUSEHOLD_MEMBER',
  'AUTHORIZED_PERSON'
);

CREATE TYPE "CustomerDeliveryAuthorizationStatus" AS ENUM (
  'ACTIVE',
  'REVOKED',
  'CONSUMED'
);

CREATE TABLE "customer_delivery_authorizations" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "authorized_by_customer_id" UUID NOT NULL,
  "recipient_display_name" VARCHAR(80) NOT NULL,
  "recipient_category" "DeliveryRecipientCategory" NOT NULL,
  "status" "CustomerDeliveryAuthorizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "idempotency_key" VARCHAR(64) NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ,
  "consumed_at" TIMESTAMPTZ,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_delivery_authorizations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customer_delivery_authorizations"
  ADD CONSTRAINT "customer_delivery_authorizations_wk_order_id_fkey"
  FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_delivery_authorizations"
  ADD CONSTRAINT "customer_delivery_authorizations_fulfillment_id_fkey"
  FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_delivery_authorizations"
  ADD CONSTRAINT "customer_delivery_authorizations_authorized_by_customer_id_fkey"
  FOREIGN KEY ("authorized_by_customer_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_delivery_authorizations"
  ADD CONSTRAINT "customer_delivery_authorizations_customer_idempotency_key"
  UNIQUE ("authorized_by_customer_id", "idempotency_key");

CREATE INDEX "customer_delivery_authorizations_fulfillment_id_status_idx"
  ON "customer_delivery_authorizations"("fulfillment_id", "status");

CREATE INDEX "customer_delivery_authorizations_wk_order_id_status_idx"
  ON "customer_delivery_authorizations"("wk_order_id", "status");

CREATE INDEX "customer_delivery_authorizations_authorized_by_customer_id_status_idx"
  ON "customer_delivery_authorizations"("authorized_by_customer_id", "status");

CREATE UNIQUE INDEX "customer_delivery_authorizations_one_active_per_fulfillment"
  ON "customer_delivery_authorizations"("fulfillment_id")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "customer_delivery_handoff_tokens"
  ADD COLUMN "authorization_id" UUID;

CREATE INDEX "customer_delivery_handoff_tokens_authorization_id_idx"
  ON "customer_delivery_handoff_tokens"("authorization_id");

ALTER TABLE "customer_delivery_handoff_tokens"
  ADD CONSTRAINT "customer_delivery_handoff_tokens_authorization_id_fkey"
  FOREIGN KEY ("authorization_id") REFERENCES "customer_delivery_authorizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
