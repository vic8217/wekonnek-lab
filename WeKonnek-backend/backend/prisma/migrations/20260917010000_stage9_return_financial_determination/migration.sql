-- Stage 9: Return Financial Determination (additive)
-- Rollback: see rollback.sql
-- Stage 9–owned enums for clean DROP on rollback.

DO $$ BEGIN
  CREATE TYPE "ReturnFinancialDeterminationStatus" AS ENUM (
    'PENDING', 'PROPOSED', 'ACKNOWLEDGED', 'FINALIZED', 'DISPUTED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnFinancialDeterminationOutcome" AS ENUM (
    'QUALIFYING_FULL_RETURN',
    'RETURN_CONDITION_DISPUTED',
    'DAMAGED_RETURN_REVIEW_REQUIRED',
    'PARTIAL_RETURN_UNSUPPORTED',
    'OPERATIONS_RECOVERY_REQUIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnFinancialObligationType" AS ENUM (
    'MERCHANT_TO_RIDER_ADVANCE_REPAYMENT',
    'MERCHANT_TO_CUSTOMER_REFUND'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnFinancialObligationStatus" AS ENUM (
    'OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnFinancialSettlementMethod" AS ENUM (
    'CASH', 'DIRECT_TRANSFER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnFinancialSettlementStatus" AS ENUM (
    'CLAIMED', 'ACKNOWLEDGED', 'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnFinancialPartyType" AS ENUM (
    'MERCHANT', 'CUSTOMER', 'RIDER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RiderAdvanceCollectionRestrictionEffect" AS ENUM (
    'TRANSFER_OUTSTANDING_TO_MERCHANT_RETURN_RESOLUTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RiderAdvanceCollectionRestrictionStatus" AS ENUM (
    'ACTIVE', 'SUPERSEDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnFinancialTermsKind" AS ENUM (
    'MERCHANT_RETURN_FINANCIAL',
    'CUSTOMER_RETURN_FINANCIAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Terms versions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "return_financial_terms_versions" (
  "id" UUID NOT NULL,
  "kind" "ReturnFinancialTermsKind" NOT NULL,
  "version_number" INTEGER NOT NULL,
  "terms_hash" VARCHAR(64) NOT NULL,
  "canonical_terms" JSONB NOT NULL,
  "activated_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "return_financial_terms_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_financial_terms_versions_version_positive_check"
    CHECK ("version_number" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_terms_versions_kind_version_number_key"
  ON "return_financial_terms_versions"("kind", "version_number");
CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_terms_versions_terms_hash_key"
  ON "return_financial_terms_versions"("terms_hash");
CREATE INDEX IF NOT EXISTS "return_financial_terms_versions_kind_activated_at_idx"
  ON "return_financial_terms_versions"("kind", "activated_at");

-- ─── Terms acceptances ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "return_financial_terms_acceptances" (
  "id" UUID NOT NULL,
  "terms_version_id" UUID NOT NULL,
  "party_type" "ReturnFinancialPartyType" NOT NULL,
  "party_user_id" UUID,
  "merchant_id" INTEGER,
  "wk_order_id" INTEGER,
  "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor_user_id" UUID NOT NULL,
  "correlation_id" VARCHAR(64),
  "terms_hash_snapshot" VARCHAR(64) NOT NULL,
  CONSTRAINT "return_financial_terms_acceptances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_financial_terms_acceptances_party_check" CHECK (
    (
      "party_type" = 'MERCHANT'
      AND "merchant_id" IS NOT NULL
      AND "party_user_id" IS NOT NULL
    )
    OR (
      "party_type" IN ('CUSTOMER', 'RIDER')
      AND "party_user_id" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_terms_acceptances_merchant_order_version_key"
  ON "return_financial_terms_acceptances"("terms_version_id", "merchant_id", "wk_order_id")
  WHERE "party_type" = 'MERCHANT' AND "wk_order_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_terms_acceptances_user_order_version_key"
  ON "return_financial_terms_acceptances"("terms_version_id", "party_user_id", "wk_order_id")
  WHERE "party_type" IN ('CUSTOMER', 'RIDER') AND "wk_order_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "return_financial_terms_acceptances_wk_order_id_idx"
  ON "return_financial_terms_acceptances"("wk_order_id");
CREATE INDEX IF NOT EXISTS "return_financial_terms_acceptances_merchant_id_idx"
  ON "return_financial_terms_acceptances"("merchant_id");

DO $$ BEGIN
  ALTER TABLE "return_financial_terms_acceptances"
    ADD CONSTRAINT "return_financial_terms_acceptances_terms_version_id_fkey"
    FOREIGN KEY ("terms_version_id") REFERENCES "return_financial_terms_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_terms_acceptances"
    ADD CONSTRAINT "return_financial_terms_acceptances_party_user_id_fkey"
    FOREIGN KEY ("party_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_terms_acceptances"
    ADD CONSTRAINT "return_financial_terms_acceptances_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_terms_acceptances"
    ADD CONSTRAINT "return_financial_terms_acceptances_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_terms_acceptances"
    ADD CONSTRAINT "return_financial_terms_acceptances_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Determination ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "return_financial_determinations" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "operational_case_id" UUID,
  "delivery_attempt_id" UUID,
  "return_custody_event_id" UUID NOT NULL,
  "rider_advance_id" UUID,
  "status" "ReturnFinancialDeterminationStatus" NOT NULL DEFAULT 'PENDING',
  "outcome" "ReturnFinancialDeterminationOutcome",
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "snapshot_principal" DECIMAL(14,2),
  "snapshot_reimbursed" DECIMAL(14,2),
  "merchant_to_rider_amount" DECIMAL(14,2),
  "merchant_to_customer_amount" DECIMAL(14,2),
  "merchant_payment_status_snapshot" "MerchantPaymentStatus",
  "merchant_terms_version_id" UUID,
  "merchant_terms_hash" VARCHAR(64),
  "customer_terms_version_id" UUID,
  "customer_terms_hash" VARCHAR(64),
  "ra_agreement_version_id" UUID,
  "ra_agreement_hash" VARCHAR(64),
  "ordinary_refund_principal" DECIMAL(14,2),
  "path" VARCHAR(32) NOT NULL DEFAULT 'RIDER_ADVANCE',
  "reason" VARCHAR(2000),
  "proposed_by_actor_type" "OrderDomainActorType",
  "proposed_by_actor_id" UUID,
  "proposed_at" TIMESTAMPTZ,
  "acknowledged_by_actor_type" "OrderDomainActorType",
  "acknowledged_by_actor_id" UUID,
  "acknowledged_at" TIMESTAMPTZ,
  "finalized_by_actor_type" "OrderDomainActorType",
  "finalized_by_actor_id" UUID,
  "finalized_at" TIMESTAMPTZ,
  "disputed_by_actor_type" "OrderDomainActorType",
  "disputed_by_actor_id" UUID,
  "disputed_at" TIMESTAMPTZ,
  "dispute_reason" VARCHAR(2000),
  "correlation_id" VARCHAR(64),
  "propose_idempotency_key" VARCHAR(64),
  "finalize_idempotency_key" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "return_financial_determinations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_financial_determinations_path_check"
    CHECK ("path" IN ('RIDER_ADVANCE', 'ORDINARY_MERCHANT_PAYMENT')),
  CONSTRAINT "return_financial_determinations_principal_nonneg_check"
    CHECK ("snapshot_principal" IS NULL OR "snapshot_principal" >= 0),
  CONSTRAINT "return_financial_determinations_reimbursed_nonneg_check"
    CHECK ("snapshot_reimbursed" IS NULL OR "snapshot_reimbursed" >= 0),
  CONSTRAINT "return_financial_determinations_m2r_nonneg_check"
    CHECK ("merchant_to_rider_amount" IS NULL OR "merchant_to_rider_amount" >= 0),
  CONSTRAINT "return_financial_determinations_m2c_nonneg_check"
    CHECK ("merchant_to_customer_amount" IS NULL OR "merchant_to_customer_amount" >= 0),
  CONSTRAINT "return_financial_determinations_ordinary_nonneg_check"
    CHECK ("ordinary_refund_principal" IS NULL OR "ordinary_refund_principal" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_determinations_one_finalized_per_order"
  ON "return_financial_determinations"("wk_order_id")
  WHERE "status" = 'FINALIZED';

CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_determinations_propose_idempotency_key_key"
  ON "return_financial_determinations"("propose_idempotency_key")
  WHERE "propose_idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_determinations_finalize_idempotency_key_key"
  ON "return_financial_determinations"("finalize_idempotency_key")
  WHERE "finalize_idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "return_financial_determinations_wk_order_id_status_idx"
  ON "return_financial_determinations"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "return_financial_determinations_fulfillment_id_idx"
  ON "return_financial_determinations"("fulfillment_id");
CREATE INDEX IF NOT EXISTS "return_financial_determinations_rider_advance_id_idx"
  ON "return_financial_determinations"("rider_advance_id");

DO $$ BEGIN
  ALTER TABLE "return_financial_determinations"
    ADD CONSTRAINT "return_financial_determinations_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_determinations"
    ADD CONSTRAINT "return_financial_determinations_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_determinations"
    ADD CONSTRAINT "return_financial_determinations_operational_case_id_fkey"
    FOREIGN KEY ("operational_case_id") REFERENCES "operational_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_determinations"
    ADD CONSTRAINT "return_financial_determinations_delivery_attempt_id_fkey"
    FOREIGN KEY ("delivery_attempt_id") REFERENCES "delivery_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_determinations"
    ADD CONSTRAINT "return_financial_determinations_return_custody_event_id_fkey"
    FOREIGN KEY ("return_custody_event_id") REFERENCES "custody_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_determinations"
    ADD CONSTRAINT "return_financial_determinations_rider_advance_id_fkey"
    FOREIGN KEY ("rider_advance_id") REFERENCES "rider_advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_determinations"
    ADD CONSTRAINT "return_financial_determinations_merchant_terms_version_id_fkey"
    FOREIGN KEY ("merchant_terms_version_id") REFERENCES "return_financial_terms_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_determinations"
    ADD CONSTRAINT "return_financial_determinations_customer_terms_version_id_fkey"
    FOREIGN KEY ("customer_terms_version_id") REFERENCES "return_financial_terms_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Immutable FINALIZED financial allocation fields
CREATE OR REPLACE FUNCTION stage9_return_financial_determination_immutable_guard()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'FINALIZED' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.outcome IS DISTINCT FROM OLD.outcome
       OR NEW.snapshot_principal IS DISTINCT FROM OLD.snapshot_principal
       OR NEW.snapshot_reimbursed IS DISTINCT FROM OLD.snapshot_reimbursed
       OR NEW.merchant_to_rider_amount IS DISTINCT FROM OLD.merchant_to_rider_amount
       OR NEW.merchant_to_customer_amount IS DISTINCT FROM OLD.merchant_to_customer_amount
       OR NEW.ordinary_refund_principal IS DISTINCT FROM OLD.ordinary_refund_principal
       OR NEW.rider_advance_id IS DISTINCT FROM OLD.rider_advance_id
       OR NEW.path IS DISTINCT FROM OLD.path
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.wk_order_id IS DISTINCT FROM OLD.wk_order_id
       OR NEW.fulfillment_id IS DISTINCT FROM OLD.fulfillment_id
       OR NEW.return_custody_event_id IS DISTINCT FROM OLD.return_custody_event_id
       OR NEW.merchant_terms_version_id IS DISTINCT FROM OLD.merchant_terms_version_id
       OR NEW.merchant_terms_hash IS DISTINCT FROM OLD.merchant_terms_hash
       OR NEW.customer_terms_version_id IS DISTINCT FROM OLD.customer_terms_version_id
       OR NEW.customer_terms_hash IS DISTINCT FROM OLD.customer_terms_hash
    THEN
      RAISE EXCEPTION 'stage9_return_financial_determination_immutable: FINALIZED financial fields cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage9_rfd_immutable_trg ON "return_financial_determinations";
CREATE TRIGGER stage9_rfd_immutable_trg
  BEFORE UPDATE ON "return_financial_determinations"
  FOR EACH ROW
  EXECUTE PROCEDURE stage9_return_financial_determination_immutable_guard();

-- A finalized decision is financial history even when it produced no money.
CREATE OR REPLACE FUNCTION stage9_return_financial_determination_append_only_guard()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'stage9_return_financial_determination_append_only: physical DELETE of finalized determination is forbidden'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage9_rfd_append_only_del_trg ON "return_financial_determinations";
CREATE TRIGGER stage9_rfd_append_only_del_trg
  BEFORE DELETE ON "return_financial_determinations"
  FOR EACH ROW
  EXECUTE PROCEDURE stage9_return_financial_determination_append_only_guard();

-- ─── Obligations ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "return_financial_obligations" (
  "id" UUID NOT NULL,
  "determination_id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "merchant_id" INTEGER NOT NULL,
  "type" "ReturnFinancialObligationType" NOT NULL,
  "debtor_type" "ReturnFinancialPartyType" NOT NULL,
  "debtor_user_id" UUID,
  "debtor_merchant_id" INTEGER,
  "creditor_type" "ReturnFinancialPartyType" NOT NULL,
  "creditor_user_id" UUID NOT NULL,
  "principal" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "status" "ReturnFinancialObligationStatus" NOT NULL DEFAULT 'OPEN',
  "reason" VARCHAR(2000),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "return_financial_obligations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_financial_obligations_principal_positive_check"
    CHECK ("principal" > 0),
  CONSTRAINT "return_financial_obligations_debtor_creditor_distinct_check"
    CHECK (
      NOT (
        "debtor_type" = "creditor_type"
        AND "debtor_user_id" IS NOT DISTINCT FROM "creditor_user_id"
        AND "debtor_merchant_id" IS NOT DISTINCT FROM NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_obligations_determination_id_type_key"
  ON "return_financial_obligations"("determination_id", "type");

CREATE INDEX IF NOT EXISTS "return_financial_obligations_wk_order_id_status_idx"
  ON "return_financial_obligations"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "return_financial_obligations_merchant_id_status_idx"
  ON "return_financial_obligations"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "return_financial_obligations_creditor_user_id_idx"
  ON "return_financial_obligations"("creditor_user_id");

DO $$ BEGIN
  ALTER TABLE "return_financial_obligations"
    ADD CONSTRAINT "return_financial_obligations_determination_id_fkey"
    FOREIGN KEY ("determination_id") REFERENCES "return_financial_determinations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_obligations"
    ADD CONSTRAINT "return_financial_obligations_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_obligations"
    ADD CONSTRAINT "return_financial_obligations_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_obligations"
    ADD CONSTRAINT "return_financial_obligations_creditor_user_id_fkey"
    FOREIGN KEY ("creditor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_obligations"
    ADD CONSTRAINT "return_financial_obligations_debtor_user_id_fkey"
    FOREIGN KEY ("debtor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_obligations"
    ADD CONSTRAINT "return_financial_obligations_debtor_merchant_id_fkey"
    FOREIGN KEY ("debtor_merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Settlements ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "return_financial_settlements" (
  "id" UUID NOT NULL,
  "obligation_id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "method" "ReturnFinancialSettlementMethod" NOT NULL,
  "status" "ReturnFinancialSettlementStatus" NOT NULL DEFAULT 'CLAIMED',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "claimed_amount" DECIMAL(14,2),
  "acknowledged_amount" DECIMAL(14,2),
  "external_reference" VARCHAR(120),
  "proof_storage_reference" VARCHAR(1000),
  "claim_evidence_id" UUID,
  "ack_evidence_id" UUID,
  "rejection_reason" VARCHAR(255),
  "claimed_at" TIMESTAMPTZ,
  "claimed_by_user_id" UUID,
  "acknowledged_at" TIMESTAMPTZ,
  "acknowledged_by_user_id" UUID,
  "rejected_at" TIMESTAMPTZ,
  "rejected_by_user_id" UUID,
  "claim_idempotency_key" VARCHAR(64),
  "ack_idempotency_key" VARCHAR(64),
  "cash_idempotency_key" VARCHAR(64),
  "reject_idempotency_key" VARCHAR(64),
  "payload_fingerprint" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "return_financial_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "return_financial_settlements_claimed_positive_check"
    CHECK ("claimed_amount" IS NULL OR "claimed_amount" > 0),
  CONSTRAINT "return_financial_settlements_ack_positive_check"
    CHECK ("acknowledged_amount" IS NULL OR "acknowledged_amount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_settlements_claim_idempotency_key_key"
  ON "return_financial_settlements"("claim_idempotency_key")
  WHERE "claim_idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_settlements_ack_idempotency_key_key"
  ON "return_financial_settlements"("ack_idempotency_key")
  WHERE "ack_idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_settlements_cash_idempotency_key_key"
  ON "return_financial_settlements"("cash_idempotency_key")
  WHERE "cash_idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "return_financial_settlements_reject_idempotency_key_key"
  ON "return_financial_settlements"("reject_idempotency_key")
  WHERE "reject_idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "return_financial_settlements_obligation_id_status_idx"
  ON "return_financial_settlements"("obligation_id", "status");
CREATE INDEX IF NOT EXISTS "return_financial_settlements_wk_order_id_status_idx"
  ON "return_financial_settlements"("wk_order_id", "status");

DO $$ BEGIN
  ALTER TABLE "return_financial_settlements"
    ADD CONSTRAINT "return_financial_settlements_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "return_financial_obligations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "return_financial_settlements"
    ADD CONSTRAINT "return_financial_settlements_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Terminal settlement financial fields immutable
CREATE OR REPLACE FUNCTION stage9_return_financial_settlement_immutable_guard()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('ACKNOWLEDGED', 'REJECTED') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.claimed_amount IS DISTINCT FROM OLD.claimed_amount
       OR NEW.acknowledged_amount IS DISTINCT FROM OLD.acknowledged_amount
       OR NEW.obligation_id IS DISTINCT FROM OLD.obligation_id
       OR NEW.wk_order_id IS DISTINCT FROM OLD.wk_order_id
    THEN
      RAISE EXCEPTION 'stage9_return_financial_settlement_immutable: terminal settlement financial fields cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage9_rfs_immutable_trg ON "return_financial_settlements";
CREATE TRIGGER stage9_rfs_immutable_trg
  BEFORE UPDATE ON "return_financial_settlements"
  FOR EACH ROW
  EXECUTE PROCEDURE stage9_return_financial_settlement_immutable_guard();

-- Append-only DELETE block on settlements
CREATE OR REPLACE FUNCTION stage9_return_financial_settlement_append_only_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage9_return_financial_settlement_append_only: physical DELETE of settlement ledger rows is forbidden'
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage9_rfs_append_only_del_trg ON "return_financial_settlements";
CREATE TRIGGER stage9_rfs_append_only_del_trg
  BEFORE DELETE ON "return_financial_settlements"
  FOR EACH ROW
  EXECUTE PROCEDURE stage9_return_financial_settlement_append_only_guard();

-- ─── Collection restrictions ────────────────────────────
CREATE TABLE IF NOT EXISTS "rider_advance_collection_restrictions" (
  "id" UUID NOT NULL,
  "rider_advance_id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "return_financial_determination_id" UUID NOT NULL,
  "restricted_amount" DECIMAL(14,2) NOT NULL,
  "effect" "RiderAdvanceCollectionRestrictionEffect" NOT NULL
    DEFAULT 'TRANSFER_OUTSTANDING_TO_MERCHANT_RETURN_RESOLUTION',
  "status" "RiderAdvanceCollectionRestrictionStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_actor_type" "OrderDomainActorType" NOT NULL,
  "created_by_actor_id" UUID NOT NULL,
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rider_advance_collection_restrictions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rider_advance_collection_restrictions_amount_positive_check"
    CHECK ("restricted_amount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "rider_advance_collection_restrictions_one_active_per_ra"
  ON "rider_advance_collection_restrictions"("rider_advance_id")
  WHERE "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "rider_advance_collection_restrictions_wk_order_id_idx"
  ON "rider_advance_collection_restrictions"("wk_order_id");
CREATE INDEX IF NOT EXISTS "rider_advance_collection_restrictions_determination_id_idx"
  ON "rider_advance_collection_restrictions"("return_financial_determination_id");

DO $$ BEGIN
  ALTER TABLE "rider_advance_collection_restrictions"
    ADD CONSTRAINT "rider_advance_collection_restrictions_rider_advance_id_fkey"
    FOREIGN KEY ("rider_advance_id") REFERENCES "rider_advances"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advance_collection_restrictions"
    ADD CONSTRAINT "rider_advance_collection_restrictions_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rider_advance_collection_restrictions"
    ADD CONSTRAINT "rider_advance_collection_restrictions_determination_id_fkey"
    FOREIGN KEY ("return_financial_determination_id")
    REFERENCES "return_financial_determinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only DELETE block on restrictions
CREATE OR REPLACE FUNCTION stage9_ra_collection_restriction_append_only_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage9_ra_collection_restriction_append_only: physical DELETE of collection restriction rows is forbidden'
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage9_racr_append_only_del_trg ON "rider_advance_collection_restrictions";
CREATE TRIGGER stage9_racr_append_only_del_trg
  BEFORE DELETE ON "rider_advance_collection_restrictions"
  FOR EACH ROW
  EXECUTE PROCEDURE stage9_ra_collection_restriction_append_only_guard();

-- Restrictions are a derived final allocation, not an independently editable
-- collection control.  This blocks raw-SQL over-restriction and cross-order/RA
-- binding as well as later mutation of the amount or status.
CREATE OR REPLACE FUNCTION stage9_ra_collection_restriction_integrity_guard()
RETURNS trigger AS $$
DECLARE det record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.rider_advance_id IS DISTINCT FROM OLD.rider_advance_id
       OR NEW.wk_order_id IS DISTINCT FROM OLD.wk_order_id
       OR NEW.return_financial_determination_id IS DISTINCT FROM OLD.return_financial_determination_id
       OR NEW.restricted_amount IS DISTINCT FROM OLD.restricted_amount
       OR NEW.effect IS DISTINCT FROM OLD.effect
       OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'stage9_ra_collection_restriction_immutable: restriction allocation cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO det FROM "return_financial_determinations"
    WHERE id = NEW.return_financial_determination_id;
  IF NOT FOUND OR det.status <> 'FINALIZED'
     OR det.rider_advance_id IS DISTINCT FROM NEW.rider_advance_id
     OR det.wk_order_id IS DISTINCT FROM NEW.wk_order_id
     OR det.path <> 'RIDER_ADVANCE'
     OR det.merchant_to_rider_amount IS NULL
     OR NEW.restricted_amount <> det.merchant_to_rider_amount
     OR NEW.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'stage9_ra_collection_restriction_invalid: restriction must exactly derive from FINALIZED RA determination'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage9_racr_integrity_trg ON "rider_advance_collection_restrictions";
CREATE TRIGGER stage9_racr_integrity_trg
  BEFORE INSERT OR UPDATE ON "rider_advance_collection_restrictions"
  FOR EACH ROW
  EXECUTE PROCEDURE stage9_ra_collection_restriction_integrity_guard();
