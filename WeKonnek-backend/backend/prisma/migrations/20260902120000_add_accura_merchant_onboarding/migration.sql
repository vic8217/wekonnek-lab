-- Additive ACCURA merchant onboarding linkage. No payment or order rows
-- are modified. Does not store ACCURA secrets or taxProfile copies.
CREATE TABLE "accura_merchant_links" (
    "id" UUID NOT NULL,
    "merchant_id" INTEGER NOT NULL,
    "external_client_reference" VARCHAR(80) NOT NULL,
    "last_review_status" VARCHAR(40),
    "last_account_status" VARCHAR(40),
    "last_synced_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accura_merchant_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accura_merchant_links_merchant_id_key" ON "accura_merchant_links"("merchant_id");
CREATE UNIQUE INDEX "accura_merchant_links_external_client_reference_key" ON "accura_merchant_links"("external_client_reference");

ALTER TABLE "accura_merchant_links"
  ADD CONSTRAINT "accura_merchant_links_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shop_accura_branch_mappings" (
    "id" UUID NOT NULL,
    "merchant_id" INTEGER NOT NULL,
    "shop_id" INTEGER NOT NULL,
    "accura_branch_id" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_accura_branch_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shop_accura_branch_mappings_shop_id_key" ON "shop_accura_branch_mappings"("shop_id");
CREATE INDEX "shop_accura_branch_mappings_merchant_id_idx" ON "shop_accura_branch_mappings"("merchant_id");

ALTER TABLE "shop_accura_branch_mappings"
  ADD CONSTRAINT "shop_accura_branch_mappings_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shop_accura_branch_mappings"
  ADD CONSTRAINT "shop_accura_branch_mappings_shop_id_fkey"
  FOREIGN KEY ("shop_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "accura_onboarding_audit_events" (
    "id" UUID NOT NULL,
    "merchant_id" INTEGER NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "result" VARCHAR(50) NOT NULL,
    "error_category" VARCHAR(80),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accura_onboarding_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accura_onboarding_audit_events_merchant_id_created_at_idx"
  ON "accura_onboarding_audit_events"("merchant_id", "created_at");

ALTER TABLE "accura_onboarding_audit_events"
  ADD CONSTRAINT "accura_onboarding_audit_events_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
