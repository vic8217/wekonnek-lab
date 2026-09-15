-- Stage 2A: agreement / evidence / custody foundation (additive)
-- Rollback: see rollback.sql

ALTER TYPE "OrderDomainAggregateType" ADD VALUE IF NOT EXISTS 'AGREEMENT';

DO $$ BEGIN
  CREATE TYPE "AgreementType" AS ENUM ('MERCHANT_TRADE', 'RIDER_ADVANCE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgreementStatus" AS ENUM (
    'DRAFT', 'OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgreementVersionStatus" AS ENUM (
    'DRAFT', 'OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgreementPartyRole" AS ENUM ('CUSTOMER', 'MERCHANT', 'RIDER', 'PLATFORM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgreementAcceptanceMethod" AS ENUM (
    'WEB_CONFIRMATION', 'MOBILE_CONFIRMATION', 'QR_CONFIRMATION', 'OTP_CONFIRMATION', 'SYSTEM_MIGRATION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgreementProvenance" AS ENUM ('LEGACY_SNAPSHOT', 'EXPLICIT_ACCEPTANCE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AgreementEvidenceType" AS ENUM (
    'PAYMENT_REFERENCE', 'PAYMENT_PROOF', 'MERCHANT_ACKNOWLEDGMENT', 'RIDER_ACKNOWLEDGMENT',
    'CUSTODY_HANDOFF', 'DELIVERY_CONFIRMATION', 'PHOTO', 'DOCUMENT', 'NOTE', 'SYSTEM_EVENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CustodyEventType" AS ENUM (
    'GOODS_PREPARED', 'MERCHANT_RELEASED', 'RIDER_RECEIVED', 'IN_TRANSIT',
    'CUSTOMER_RECEIVED', 'RETURN_INITIATED', 'RETURN_RECEIVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "trust_trade_transactions"
  ADD COLUMN IF NOT EXISTS "agreement_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "trust_trade_transactions_agreement_id_key"
  ON "trust_trade_transactions"("agreement_id");

CREATE TABLE IF NOT EXISTS "agreements" (
  "id" UUID NOT NULL,
  "agreement_type" "AgreementType" NOT NULL,
  "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
  "provenance" "AgreementProvenance" NOT NULL DEFAULT 'EXPLICIT_ACCEPTANCE',
  "wk_order_id" INTEGER,
  "fulfillment_id" UUID,
  "required_party_roles" JSONB NOT NULL,
  "current_version_id" UUID,
  "cancelled_at" TIMESTAMPTZ,
  "cancelled_by" UUID,
  "cancellation_reason" VARCHAR(255),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "agreements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agreements_current_version_id_key" ON "agreements"("current_version_id");
CREATE INDEX IF NOT EXISTS "agreements_agreement_type_status_idx" ON "agreements"("agreement_type", "status");
CREATE INDEX IF NOT EXISTS "agreements_wk_order_id_created_at_idx" ON "agreements"("wk_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "agreements_fulfillment_id_idx" ON "agreements"("fulfillment_id");

CREATE TABLE IF NOT EXISTS "agreement_versions" (
  "id" UUID NOT NULL,
  "agreement_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" "AgreementVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "canonical_schema" VARCHAR(64) NOT NULL,
  "terms_snapshot" JSONB NOT NULL,
  "terms_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ,
  "supersedes_version_id" UUID,
  "amendment_reason" VARCHAR(255),
  "amended_by_user_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agreement_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agreement_versions_agreement_id_version_number_key"
  ON "agreement_versions"("agreement_id", "version_number");
CREATE INDEX IF NOT EXISTS "agreement_versions_terms_hash_idx" ON "agreement_versions"("terms_hash");
CREATE INDEX IF NOT EXISTS "agreement_versions_status_expires_at_idx" ON "agreement_versions"("status", "expires_at");

CREATE TABLE IF NOT EXISTS "agreement_parties" (
  "id" UUID NOT NULL,
  "agreement_id" UUID NOT NULL,
  "role" "AgreementPartyRole" NOT NULL,
  "user_id" UUID,
  "merchant_id" INTEGER,
  "historical_label" VARCHAR(200),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agreement_parties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agreement_parties_agreement_id_role_key" ON "agreement_parties"("agreement_id", "role");
CREATE INDEX IF NOT EXISTS "agreement_parties_user_id_idx" ON "agreement_parties"("user_id");
CREATE INDEX IF NOT EXISTS "agreement_parties_merchant_id_idx" ON "agreement_parties"("merchant_id");

CREATE TABLE IF NOT EXISTS "agreement_acceptances" (
  "id" UUID NOT NULL,
  "agreement_version_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "party_role" "AgreementPartyRole" NOT NULL,
  "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptance_method" "AgreementAcceptanceMethod" NOT NULL,
  "terms_hash" VARCHAR(64) NOT NULL,
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agreement_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agreement_acceptances_agreement_version_id_actor_user_id_party_role_key"
  ON "agreement_acceptances"("agreement_version_id", "actor_user_id", "party_role");
CREATE INDEX IF NOT EXISTS "agreement_acceptances_correlation_id_idx" ON "agreement_acceptances"("correlation_id");

CREATE TABLE IF NOT EXISTS "agreement_evidences" (
  "id" UUID NOT NULL,
  "agreement_id" UUID NOT NULL,
  "agreement_version_id" UUID,
  "wk_order_id" INTEGER,
  "evidence_type" "AgreementEvidenceType" NOT NULL,
  "content_hash" VARCHAR(64),
  "content_type" VARCHAR(120),
  "size_bytes" INTEGER,
  "storage_reference" VARCHAR(1000),
  "captured_at" TIMESTAMPTZ,
  "submitted_by" UUID NOT NULL,
  "metadata" JSONB,
  "finalized" BOOLEAN NOT NULL DEFAULT true,
  "superseded_by_id" UUID,
  "idempotency_key" VARCHAR(64),
  "merchant_payment_evidence_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agreement_evidences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agreement_evidences_superseded_by_id_key" ON "agreement_evidences"("superseded_by_id");
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_evidences_idempotency_key_key" ON "agreement_evidences"("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_evidences_merchant_payment_evidence_id_key"
  ON "agreement_evidences"("merchant_payment_evidence_id");
CREATE INDEX IF NOT EXISTS "agreement_evidences_agreement_id_created_at_idx" ON "agreement_evidences"("agreement_id", "created_at");
CREATE INDEX IF NOT EXISTS "agreement_evidences_wk_order_id_created_at_idx" ON "agreement_evidences"("wk_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "agreement_evidences_evidence_type_idx" ON "agreement_evidences"("evidence_type");

CREATE TABLE IF NOT EXISTS "custody_events" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER,
  "fulfillment_id" UUID,
  "agreement_id" UUID,
  "event_type" "CustodyEventType" NOT NULL,
  "from_party_role" "AgreementPartyRole",
  "to_party_role" "AgreementPartyRole",
  "from_user_id" UUID,
  "to_user_id" UUID,
  "actor_user_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "correlation_id" VARCHAR(64),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "custody_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "custody_events_wk_order_id_occurred_at_idx" ON "custody_events"("wk_order_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "custody_events_fulfillment_id_occurred_at_idx" ON "custody_events"("fulfillment_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "custody_events_agreement_id_occurred_at_idx" ON "custody_events"("agreement_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "custody_events_correlation_id_idx" ON "custody_events"("correlation_id");

CREATE TABLE IF NOT EXISTS "custody_event_evidences" (
  "id" UUID NOT NULL,
  "custody_event_id" UUID NOT NULL,
  "evidence_id" UUID NOT NULL,
  CONSTRAINT "custody_event_evidences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "custody_event_evidences_custody_event_id_evidence_id_key"
  ON "custody_event_evidences"("custody_event_id", "evidence_id");

-- FKs (idempotent)
DO $$ BEGIN
  ALTER TABLE "agreements" ADD CONSTRAINT "agreements_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreements" ADD CONSTRAINT "agreements_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_supersedes_version_id_fkey"
    FOREIGN KEY ("supersedes_version_id") REFERENCES "agreement_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreements" ADD CONSTRAINT "agreements_current_version_id_fkey"
    FOREIGN KEY ("current_version_id") REFERENCES "agreement_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreement_parties" ADD CONSTRAINT "agreement_parties_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreement_acceptances" ADD CONSTRAINT "agreement_acceptances_agreement_version_id_fkey"
    FOREIGN KEY ("agreement_version_id") REFERENCES "agreement_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreement_evidences" ADD CONSTRAINT "agreement_evidences_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreement_evidences" ADD CONSTRAINT "agreement_evidences_agreement_version_id_fkey"
    FOREIGN KEY ("agreement_version_id") REFERENCES "agreement_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreement_evidences" ADD CONSTRAINT "agreement_evidences_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreement_evidences" ADD CONSTRAINT "agreement_evidences_superseded_by_id_fkey"
    FOREIGN KEY ("superseded_by_id") REFERENCES "agreement_evidences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "custody_event_evidences" ADD CONSTRAINT "custody_event_evidences_custody_event_id_fkey"
    FOREIGN KEY ("custody_event_id") REFERENCES "custody_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "custody_event_evidences" ADD CONSTRAINT "custody_event_evidences_evidence_id_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "agreement_evidences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "trust_trade_transactions" ADD CONSTRAINT "trust_trade_transactions_agreement_id_fkey"
    FOREIGN KEY ("agreement_id") REFERENCES "agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "agreement_evidences" ADD CONSTRAINT "agreement_evidences_merchant_payment_evidence_id_fkey"
    FOREIGN KEY ("merchant_payment_evidence_id") REFERENCES "merchant_payment_evidences"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
