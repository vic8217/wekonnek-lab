-- Stage 12: Exception Financial Liability & Claims (additive)
-- Rollback: see rollback.sql
-- Frozen parent = Stage 11. No Stage 9/5B/7/11 object is altered here.
-- Stage 12–owned enums for clean DROP on rollback.

DO $$ BEGIN
  CREATE TYPE "EconomicLossKind" AS ENUM (
    'GOODS_LOST',
    'GOODS_DAMAGED',
    'GOODS_NOT_RETURNED',
    'GOODS_NON_CONFORMING',
    'RIDER_ADVANCE_UNRECOVERED',
    'CUSTOMER_PAYMENT_UNRECOVERED',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EconomicLossCoverageSourceKind" AS ENUM (
    'STAGE9_OBLIGATION',
    'STAGE12_OBLIGATION',
    'EXTERNAL_RECOVERY',
    'ADMIN_WRITE_OFF'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExceptionClaimType" AS ENUM (
    'GOODS_LOSS',
    'GOODS_DAMAGE',
    'NON_RETURN',
    'GOODS_NON_CONFORMANCE',
    'UNRECOVERED_ADVANCE',
    'UNRECOVERED_PAYMENT',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "GoodsNonConformanceReasonCode" AS ENUM (
    'WRONG_ITEM',
    'WRONG_VARIANT',
    'WRONG_SIZE',
    'WRONG_COLOR',
    'WRONG_QUANTITY',
    'MISSING_ITEM',
    'MATERIAL_SPEC_MISMATCH',
    'OTHER_NON_CONFORMANCE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExceptionClaimStatus" AS ENUM (
    'OPEN',
    'EVIDENCE_REVIEW',
    'VERIFIED',
    'DETERMINATION_PROPOSED',
    'FINALIZED',
    'REJECTED',
    'WITHDRAWN',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ClaimEvidenceVisibility" AS ENUM (
    'ADMIN_ONLY',
    'CLAIM_PARTIES',
    'ALL_ORDER_PARTIES'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ClaimEvidenceKind" AS ENUM (
    'PHOTO_REFERENCE',
    'DOCUMENT_REFERENCE',
    'STATEMENT',
    'CUSTODY_TRAIL_REFERENCE',
    'SYSTEM_RECORD',
    'ORDER_TERMS_SNAPSHOT',
    'DELIVERY_ATTEMPT_REFERENCE',
    'OPERATIONS_RECOVERY_REFERENCE',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ClaimVerificationStatus" AS ENUM (
    'PENDING',
    'VERIFIED',
    'REJECTED',
    'INCONCLUSIVE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "VerifiedFactType" AS ENUM (
    'GOODS_LOST_CONFIRMED',
    'GOODS_DAMAGED_CONFIRMED',
    'CUSTODY_LAST_HOLDER_CONFIRMED',
    'RETURN_NOT_COMPLETED_CONFIRMED',
    'PAYMENT_NOT_COLLECTED_CONFIRMED',
    'PARTY_NEGLIGENCE_CONFIRMED',
    'NO_PARTY_FAULT_CONFIRMED',
    'GOODS_NON_CONFORMANCE_CONFIRMED',
    'GOODS_CONFORMANCE_CONFIRMED',
    'NON_CONFORMANCE_ALLEGATION_UNSUPPORTED',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LiabilityDeterminationStatus" AS ENUM (
    'DRAFT',
    'PROPOSED',
    'FINALIZED',
    'CANCELLED',
    'SUPERSEDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PLATFORM is intentionally absent: Stage 12 never allocates liability to the
-- platform. A trigger additionally rejects any attempt to introduce it.
DO $$ BEGIN
  CREATE TYPE "ExceptionLiablePartyType" AS ENUM (
    'CUSTOMER',
    'MERCHANT',
    'RIDER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExceptionFinancialObligationStatus" AS ENUM (
    'OPEN',
    'PARTIALLY_SETTLED',
    'SETTLED',
    'CANCELLED',
    'WRITTEN_OFF'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExceptionLiabilityPolicyStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'SUPERSEDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExceptionClaimEventType" AS ENUM (
    'CLAIM_OPENED',
    'EVIDENCE_ADDED',
    'EVIDENCE_VERIFIED',
    'FACT_CONCLUDED',
    'DETERMINATION_CREATED',
    'DETERMINATION_PROPOSED',
    'DETERMINATION_FINALIZED',
    'ADJUSTMENT_CREATED',
    'COVERAGE_IMPORTED',
    'OBLIGATION_CREATED',
    'CLAIM_REJECTED',
    'CLAIM_WITHDRAWN',
    'CLAIM_CANCELLED',
    'NOTE_ADDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── exception_liability_policy_versions ───────────────────────────────

CREATE TABLE IF NOT EXISTS "exception_liability_policy_versions" (
  "id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "policy_hash" VARCHAR(64) NOT NULL,
  "canonical_policy" JSONB NOT NULL,
  "status" "ExceptionLiabilityPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "activated_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exception_liability_policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exception_liability_policy_versions_version_number_key"
  ON "exception_liability_policy_versions"("version_number");
CREATE UNIQUE INDEX IF NOT EXISTS "exception_liability_policy_versions_policy_hash_key"
  ON "exception_liability_policy_versions"("policy_hash");
CREATE INDEX IF NOT EXISTS "exception_liability_policy_versions_status_activated_idx"
  ON "exception_liability_policy_versions"("status", "activated_at");

-- ─── economic_losses ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "economic_losses" (
  "id" UUID NOT NULL,
  "economic_loss_key" VARCHAR(200) NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "operations_recovery_id" UUID,
  "loss_kind" "EconomicLossKind" NOT NULL,
  "subject_ref" VARCHAR(200) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "gross_loss_amount" DECIMAL(14,2) NOT NULL,
  "fee_component_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "compensable_amount" DECIMAL(14,2) NOT NULL,
  "notes" VARCHAR(2000),
  "created_by_actor_type" "OrderDomainActorType" NOT NULL,
  "created_by_actor_id" UUID NOT NULL,
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "economic_losses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "economic_losses_amounts_nonneg_check"
    CHECK (
      "gross_loss_amount" >= 0
      AND "fee_component_amount" >= 0
      AND "compensable_amount" >= 0
    ),
  CONSTRAINT "economic_losses_compensable_le_gross_check"
    CHECK ("compensable_amount" <= "gross_loss_amount"),
  CONSTRAINT "economic_losses_subject_ref_nonblank_check"
    CHECK (length(btrim("subject_ref")) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "economic_losses_economic_loss_key_key"
  ON "economic_losses"("economic_loss_key");
CREATE UNIQUE INDEX IF NOT EXISTS "economic_losses_order_kind_subject_key"
  ON "economic_losses"("wk_order_id", "loss_kind", "subject_ref");
CREATE INDEX IF NOT EXISTS "economic_losses_wk_order_id_idx"
  ON "economic_losses"("wk_order_id");
CREATE INDEX IF NOT EXISTS "economic_losses_fulfillment_id_idx"
  ON "economic_losses"("fulfillment_id");

DO $$ BEGIN
  ALTER TABLE "economic_losses"
    ADD CONSTRAINT "economic_losses_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "economic_losses"
    ADD CONSTRAINT "economic_losses_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "economic_losses"
    ADD CONSTRAINT "economic_losses_operations_recovery_id_fkey"
    FOREIGN KEY ("operations_recovery_id") REFERENCES "operations_recoveries"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── economic_loss_coverages (append-only) ─────────────────────────────

CREATE TABLE IF NOT EXISTS "economic_loss_coverages" (
  "id" UUID NOT NULL,
  "economic_loss_id" UUID NOT NULL,
  "source_kind" "EconomicLossCoverageSourceKind" NOT NULL,
  "source_ref" VARCHAR(200) NOT NULL,
  "stage9_obligation_id" UUID,
  "subject_ref_snapshot" VARCHAR(200) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "notes" VARCHAR(2000),
  "created_by_actor_type" "OrderDomainActorType" NOT NULL,
  "created_by_actor_id" UUID NOT NULL,
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "economic_loss_coverages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "economic_loss_coverages_amount_positive_check"
    CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "economic_loss_coverages_loss_source_key"
  ON "economic_loss_coverages"("economic_loss_id", "source_kind", "source_ref");
CREATE INDEX IF NOT EXISTS "economic_loss_coverages_loss_created_idx"
  ON "economic_loss_coverages"("economic_loss_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "economic_loss_coverages"
    ADD CONSTRAINT "economic_loss_coverages_economic_loss_id_fkey"
    FOREIGN KEY ("economic_loss_id") REFERENCES "economic_losses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "economic_loss_coverages"
    ADD CONSTRAINT "economic_loss_coverages_stage9_obligation_id_fkey"
    FOREIGN KEY ("stage9_obligation_id") REFERENCES "return_financial_obligations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── exception_claims ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "exception_claims" (
  "id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "operations_recovery_id" UUID NOT NULL,
  "economic_loss_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "policy_hash" VARCHAR(64) NOT NULL,
  "claim_type" "ExceptionClaimType" NOT NULL,
  "non_conformance_reason_code" "GoodsNonConformanceReasonCode",
  "status" "ExceptionClaimStatus" NOT NULL DEFAULT 'OPEN',
  "subject_ref" VARCHAR(200) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "claimed_amount" DECIMAL(14,2),
  "notes" VARCHAR(2000),
  "opened_by_actor_type" "OrderDomainActorType" NOT NULL,
  "opened_by_actor_id" UUID NOT NULL,
  "correlation_id" VARCHAR(64) NOT NULL,
  "open_idempotency_key" VARCHAR(64),
  "open_payload_hash" VARCHAR(64),
  "terminal_reason" VARCHAR(2000),
  "finalized_at" TIMESTAMPTZ,
  "rejected_at" TIMESTAMPTZ,
  "withdrawn_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exception_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exception_claims_claimed_amount_nonneg_check"
    CHECK ("claimed_amount" IS NULL OR "claimed_amount" >= 0),
  CONSTRAINT "exception_claims_non_conformance_reason_check"
    CHECK (
      ("claim_type" <> 'GOODS_NON_CONFORMANCE'::"ExceptionClaimType"
        AND "non_conformance_reason_code" IS NULL)
      OR
      ("claim_type" = 'GOODS_NON_CONFORMANCE'::"ExceptionClaimType"
        AND "non_conformance_reason_code" IS NOT NULL)
    ),
  CONSTRAINT "exception_claims_terminal_reason_check"
    CHECK (
      "status" NOT IN ('REJECTED', 'WITHDRAWN', 'CANCELLED')
      OR ("terminal_reason" IS NOT NULL AND length(btrim("terminal_reason")) > 0)
    )
);

CREATE INDEX IF NOT EXISTS "exception_claims_wk_order_id_status_idx"
  ON "exception_claims"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "exception_claims_economic_loss_id_status_idx"
  ON "exception_claims"("economic_loss_id", "status");
CREATE INDEX IF NOT EXISTS "exception_claims_operations_recovery_id_idx"
  ON "exception_claims"("operations_recovery_id");

-- At most one non-terminal claim per economic loss.
CREATE UNIQUE INDEX IF NOT EXISTS "exception_claims_one_active_per_economic_loss"
  ON "exception_claims"("economic_loss_id")
  WHERE "status" IN ('OPEN', 'EVIDENCE_REVIEW', 'VERIFIED', 'DETERMINATION_PROPOSED');

CREATE UNIQUE INDEX IF NOT EXISTS "exception_claims_open_idem_unique"
  ON "exception_claims"("opened_by_actor_id", "open_idempotency_key")
  WHERE "open_idempotency_key" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "exception_claims"
    ADD CONSTRAINT "exception_claims_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_claims"
    ADD CONSTRAINT "exception_claims_fulfillment_id_fkey"
    FOREIGN KEY ("fulfillment_id") REFERENCES "order_fulfillments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_claims"
    ADD CONSTRAINT "exception_claims_operations_recovery_id_fkey"
    FOREIGN KEY ("operations_recovery_id") REFERENCES "operations_recoveries"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_claims"
    ADD CONSTRAINT "exception_claims_economic_loss_id_fkey"
    FOREIGN KEY ("economic_loss_id") REFERENCES "economic_losses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_claims"
    ADD CONSTRAINT "exception_claims_policy_version_id_fkey"
    FOREIGN KEY ("policy_version_id") REFERENCES "exception_liability_policy_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_claims"
    ADD CONSTRAINT "exception_claims_opened_by_fkey"
    FOREIGN KEY ("opened_by_actor_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── exception_claim_events (append-only) ──────────────────────────────

CREATE TABLE IF NOT EXISTS "exception_claim_events" (
  "id" UUID NOT NULL,
  "exception_claim_id" UUID NOT NULL,
  "event_type" "ExceptionClaimEventType" NOT NULL,
  "from_status" "ExceptionClaimStatus",
  "to_status" "ExceptionClaimStatus",
  "actor_type" "OrderDomainActorType" NOT NULL,
  "actor_id" UUID NOT NULL,
  "reason" VARCHAR(2000),
  "correlation_id" VARCHAR(64),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exception_claim_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "exception_claim_events_claim_created_idx"
  ON "exception_claim_events"("exception_claim_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "exception_claim_events"
    ADD CONSTRAINT "exception_claim_events_claim_fkey"
    FOREIGN KEY ("exception_claim_id") REFERENCES "exception_claims"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── exception_claim_evidence (append-only) ────────────────────────────

CREATE TABLE IF NOT EXISTS "exception_claim_evidence" (
  "id" UUID NOT NULL,
  "exception_claim_id" UUID NOT NULL,
  "evidence_kind" "ClaimEvidenceKind" NOT NULL,
  "visibility" "ClaimEvidenceVisibility" NOT NULL DEFAULT 'ADMIN_ONLY',
  "storage_reference" VARCHAR(1000),
  "content_hash" VARCHAR(64),
  "content_type" VARCHAR(120),
  "notes" VARCHAR(2000),
  "metadata" JSONB,
  "submitted_by_actor_type" "OrderDomainActorType" NOT NULL,
  "submitted_by_actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(64),
  "payload_hash" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exception_claim_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "exception_claim_evidence_claim_created_idx"
  ON "exception_claim_evidence"("exception_claim_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "exception_claim_evidence_idem_unique"
  ON "exception_claim_evidence"("submitted_by_actor_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "exception_claim_evidence"
    ADD CONSTRAINT "exception_claim_evidence_claim_fkey"
    FOREIGN KEY ("exception_claim_id") REFERENCES "exception_claims"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── exception_claim_verifications (append-only) ───────────────────────

CREATE TABLE IF NOT EXISTS "exception_claim_verifications" (
  "id" UUID NOT NULL,
  "exception_claim_id" UUID NOT NULL,
  "evidence_id" UUID NOT NULL,
  "verification_status" "ClaimVerificationStatus" NOT NULL,
  "notes" VARCHAR(2000),
  "metadata" JSONB,
  "verified_by_actor_type" "OrderDomainActorType" NOT NULL,
  "verified_by_actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(64),
  "payload_hash" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exception_claim_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "exception_claim_verifications_claim_created_idx"
  ON "exception_claim_verifications"("exception_claim_id", "created_at");
CREATE INDEX IF NOT EXISTS "exception_claim_verifications_evidence_created_idx"
  ON "exception_claim_verifications"("evidence_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "exception_claim_verifications_idem_unique"
  ON "exception_claim_verifications"("verified_by_actor_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "exception_claim_verifications"
    ADD CONSTRAINT "exception_claim_verifications_claim_fkey"
    FOREIGN KEY ("exception_claim_id") REFERENCES "exception_claims"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_claim_verifications"
    ADD CONSTRAINT "exception_claim_verifications_evidence_fkey"
    FOREIGN KEY ("evidence_id") REFERENCES "exception_claim_evidence"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── verified_facts (immutable) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "verified_facts" (
  "id" UUID NOT NULL,
  "exception_claim_id" UUID NOT NULL,
  "fact_type" "VerifiedFactType" NOT NULL,
  "subject_ref" VARCHAR(200) NOT NULL,
  "attributed_party_type" "ExceptionLiablePartyType",
  "attributed_party_user_id" UUID,
  "attributed_merchant_id" INTEGER,
  "supporting_evidence_id" UUID,
  "statement" VARCHAR(2000) NOT NULL,
  "metadata" JSONB,
  "concluded_by_actor_type" "OrderDomainActorType" NOT NULL,
  "concluded_by_actor_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(64),
  "payload_hash" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verified_facts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "verified_facts_statement_nonblank_check"
    CHECK (length(btrim("statement")) > 0)
);

CREATE INDEX IF NOT EXISTS "verified_facts_claim_created_idx"
  ON "verified_facts"("exception_claim_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "verified_facts_idem_unique"
  ON "verified_facts"("concluded_by_actor_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "verified_facts"
    ADD CONSTRAINT "verified_facts_claim_fkey"
    FOREIGN KEY ("exception_claim_id") REFERENCES "exception_claims"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── liability_determinations ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "liability_determinations" (
  "id" UUID NOT NULL,
  "exception_claim_id" UUID NOT NULL,
  "economic_loss_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "policy_hash" VARCHAR(64) NOT NULL,
  "status" "LiabilityDeterminationStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "total_liability_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "compensable_amount_snapshot" DECIMAL(14,2),
  "prior_coverage_amount_snapshot" DECIMAL(14,2),
  "remaining_amount_snapshot" DECIMAL(14,2),
  "stage9_determination_id" UUID,
  "adjustment_of_determination_id" UUID,
  "reason" VARCHAR(2000),
  "created_by_actor_type" "OrderDomainActorType" NOT NULL,
  "created_by_actor_id" UUID NOT NULL,
  "proposed_by_actor_type" "OrderDomainActorType",
  "proposed_by_actor_id" UUID,
  "proposed_at" TIMESTAMPTZ,
  "finalized_by_actor_type" "OrderDomainActorType",
  "finalized_by_actor_id" UUID,
  "finalized_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ,
  "correlation_id" VARCHAR(64),
  "create_idempotency_key" VARCHAR(64),
  "create_payload_hash" VARCHAR(64),
  "propose_idempotency_key" VARCHAR(64),
  "propose_payload_hash" VARCHAR(64),
  "finalize_idempotency_key" VARCHAR(64),
  "finalize_payload_hash" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "liability_determinations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "liability_determinations_total_nonneg_check"
    CHECK ("total_liability_amount" >= 0),
  CONSTRAINT "liability_determinations_finalized_fields_check"
    CHECK (
      "status" <> 'FINALIZED'
      OR (
        "finalized_at" IS NOT NULL
        AND "finalized_by_actor_id" IS NOT NULL
        AND "remaining_amount_snapshot" IS NOT NULL
        AND "total_liability_amount" <= "remaining_amount_snapshot"
      )
    ),
  CONSTRAINT "liability_determinations_no_self_adjustment_check"
    CHECK ("adjustment_of_determination_id" IS NULL
           OR "adjustment_of_determination_id" <> "id")
);

CREATE INDEX IF NOT EXISTS "liability_determinations_claim_status_idx"
  ON "liability_determinations"("exception_claim_id", "status");
CREATE INDEX IF NOT EXISTS "liability_determinations_loss_status_idx"
  ON "liability_determinations"("economic_loss_id", "status");

-- At most one non-terminal (DRAFT/PROPOSED) determination per claim.
CREATE UNIQUE INDEX IF NOT EXISTS "liability_determinations_one_active_per_claim"
  ON "liability_determinations"("exception_claim_id")
  WHERE "status" IN ('DRAFT', 'PROPOSED');

CREATE UNIQUE INDEX IF NOT EXISTS "liability_determinations_create_idem_unique"
  ON "liability_determinations"("created_by_actor_id", "create_idempotency_key")
  WHERE "create_idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "liability_determinations_finalize_idem_unique"
  ON "liability_determinations"("id", "finalize_idempotency_key")
  WHERE "finalize_idempotency_key" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "liability_determinations"
    ADD CONSTRAINT "liability_determinations_claim_fkey"
    FOREIGN KEY ("exception_claim_id") REFERENCES "exception_claims"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "liability_determinations"
    ADD CONSTRAINT "liability_determinations_economic_loss_fkey"
    FOREIGN KEY ("economic_loss_id") REFERENCES "economic_losses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "liability_determinations"
    ADD CONSTRAINT "liability_determinations_policy_version_fkey"
    FOREIGN KEY ("policy_version_id") REFERENCES "exception_liability_policy_versions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "liability_determinations"
    ADD CONSTRAINT "liability_determinations_adjustment_of_fkey"
    FOREIGN KEY ("adjustment_of_determination_id") REFERENCES "liability_determinations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── liability_allocations ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "liability_allocations" (
  "id" UUID NOT NULL,
  "liability_determination_id" UUID NOT NULL,
  "party_type" "ExceptionLiablePartyType" NOT NULL,
  "party_user_id" UUID,
  "party_merchant_id" INTEGER,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "verified_fact_id" UUID,
  "basis" VARCHAR(2000),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "liability_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "liability_allocations_amount_positive_check"
    CHECK ("amount" > 0),
  -- Defence in depth alongside the PLATFORM-reject trigger: the liable party
  -- must resolve to a concrete merchant or user, never to the platform.
  CONSTRAINT "liability_allocations_party_binding_check"
    CHECK (
      ("party_type" = 'MERCHANT' AND "party_merchant_id" IS NOT NULL AND "party_user_id" IS NULL)
      OR ("party_type" IN ('CUSTOMER', 'RIDER') AND "party_user_id" IS NOT NULL AND "party_merchant_id" IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS "liability_allocations_determination_idx"
  ON "liability_allocations"("liability_determination_id");

DO $$ BEGIN
  ALTER TABLE "liability_allocations"
    ADD CONSTRAINT "liability_allocations_determination_fkey"
    FOREIGN KEY ("liability_determination_id") REFERENCES "liability_determinations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "liability_allocations"
    ADD CONSTRAINT "liability_allocations_party_user_fkey"
    FOREIGN KEY ("party_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "liability_allocations"
    ADD CONSTRAINT "liability_allocations_party_merchant_fkey"
    FOREIGN KEY ("party_merchant_id") REFERENCES "merchants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "liability_allocations"
    ADD CONSTRAINT "liability_allocations_verified_fact_fkey"
    FOREIGN KEY ("verified_fact_id") REFERENCES "verified_facts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── exception_financial_obligations ───────────────────────────────────

CREATE TABLE IF NOT EXISTS "exception_financial_obligations" (
  "id" UUID NOT NULL,
  "liability_determination_id" UUID NOT NULL,
  "exception_claim_id" UUID NOT NULL,
  "economic_loss_id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "debtor_type" "ExceptionLiablePartyType" NOT NULL,
  "debtor_user_id" UUID,
  "debtor_merchant_id" INTEGER,
  "creditor_type" "ExceptionLiablePartyType" NOT NULL,
  "creditor_user_id" UUID,
  "creditor_merchant_id" INTEGER,
  "principal" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "status" "ExceptionFinancialObligationStatus" NOT NULL DEFAULT 'OPEN',
  "reason" VARCHAR(2000),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exception_financial_obligations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exception_financial_obligations_principal_positive_check"
    CHECK ("principal" > 0),
  CONSTRAINT "exception_financial_obligations_debtor_binding_check"
    CHECK (
      ("debtor_type" = 'MERCHANT' AND "debtor_merchant_id" IS NOT NULL AND "debtor_user_id" IS NULL)
      OR ("debtor_type" IN ('CUSTOMER', 'RIDER') AND "debtor_user_id" IS NOT NULL AND "debtor_merchant_id" IS NULL)
    ),
  CONSTRAINT "exception_financial_obligations_creditor_binding_check"
    CHECK (
      ("creditor_type" = 'MERCHANT' AND "creditor_merchant_id" IS NOT NULL AND "creditor_user_id" IS NULL)
      OR ("creditor_type" IN ('CUSTOMER', 'RIDER') AND "creditor_user_id" IS NOT NULL AND "creditor_merchant_id" IS NULL)
    ),
  CONSTRAINT "exception_financial_obligations_distinct_parties_check"
    CHECK (
      "debtor_type" <> "creditor_type"
      OR "debtor_user_id" IS DISTINCT FROM "creditor_user_id"
      OR "debtor_merchant_id" IS DISTINCT FROM "creditor_merchant_id"
    )
);

CREATE INDEX IF NOT EXISTS "exception_financial_obligations_order_status_idx"
  ON "exception_financial_obligations"("wk_order_id", "status");
CREATE INDEX IF NOT EXISTS "exception_financial_obligations_determination_idx"
  ON "exception_financial_obligations"("liability_determination_id");
CREATE INDEX IF NOT EXISTS "exception_financial_obligations_claim_status_idx"
  ON "exception_financial_obligations"("exception_claim_id", "status");

DO $$ BEGIN
  ALTER TABLE "exception_financial_obligations"
    ADD CONSTRAINT "exception_financial_obligations_determination_fkey"
    FOREIGN KEY ("liability_determination_id") REFERENCES "liability_determinations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_obligations"
    ADD CONSTRAINT "exception_financial_obligations_claim_fkey"
    FOREIGN KEY ("exception_claim_id") REFERENCES "exception_claims"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_obligations"
    ADD CONSTRAINT "exception_financial_obligations_economic_loss_fkey"
    FOREIGN KEY ("economic_loss_id") REFERENCES "economic_losses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_obligations"
    ADD CONSTRAINT "exception_financial_obligations_wk_order_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_obligations"
    ADD CONSTRAINT "exception_financial_obligations_debtor_user_fkey"
    FOREIGN KEY ("debtor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_obligations"
    ADD CONSTRAINT "exception_financial_obligations_debtor_merchant_fkey"
    FOREIGN KEY ("debtor_merchant_id") REFERENCES "merchants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_obligations"
    ADD CONSTRAINT "exception_financial_obligations_creditor_user_fkey"
    FOREIGN KEY ("creditor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_obligations"
    ADD CONSTRAINT "exception_financial_obligations_creditor_merchant_fkey"
    FOREIGN KEY ("creditor_merchant_id") REFERENCES "merchants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Stage 12 integrity triggers
-- ═══════════════════════════════════════════════════════════════════════

-- Append-only children: no UPDATE, no DELETE.
CREATE OR REPLACE FUNCTION stage12_exception_children_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage12_exception_append_only: % of % is forbidden',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_claim_events_append_only_upd_trg ON "exception_claim_events";
CREATE TRIGGER stage12_claim_events_append_only_upd_trg
  BEFORE UPDATE ON "exception_claim_events"
  FOR EACH ROW EXECUTE FUNCTION stage12_exception_children_append_only();

DROP TRIGGER IF EXISTS stage12_claim_events_append_only_del_trg ON "exception_claim_events";
CREATE TRIGGER stage12_claim_events_append_only_del_trg
  BEFORE DELETE ON "exception_claim_events"
  FOR EACH ROW EXECUTE FUNCTION stage12_exception_children_append_only();

DROP TRIGGER IF EXISTS stage12_claim_evidence_append_only_upd_trg ON "exception_claim_evidence";
CREATE TRIGGER stage12_claim_evidence_append_only_upd_trg
  BEFORE UPDATE ON "exception_claim_evidence"
  FOR EACH ROW EXECUTE FUNCTION stage12_exception_children_append_only();

DROP TRIGGER IF EXISTS stage12_claim_evidence_append_only_del_trg ON "exception_claim_evidence";
CREATE TRIGGER stage12_claim_evidence_append_only_del_trg
  BEFORE DELETE ON "exception_claim_evidence"
  FOR EACH ROW EXECUTE FUNCTION stage12_exception_children_append_only();

DROP TRIGGER IF EXISTS stage12_claim_verifications_append_only_upd_trg ON "exception_claim_verifications";
CREATE TRIGGER stage12_claim_verifications_append_only_upd_trg
  BEFORE UPDATE ON "exception_claim_verifications"
  FOR EACH ROW EXECUTE FUNCTION stage12_exception_children_append_only();

DROP TRIGGER IF EXISTS stage12_claim_verifications_append_only_del_trg ON "exception_claim_verifications";
CREATE TRIGGER stage12_claim_verifications_append_only_del_trg
  BEFORE DELETE ON "exception_claim_verifications"
  FOR EACH ROW EXECUTE FUNCTION stage12_exception_children_append_only();

DROP TRIGGER IF EXISTS stage12_coverage_append_only_upd_trg ON "economic_loss_coverages";
CREATE TRIGGER stage12_coverage_append_only_upd_trg
  BEFORE UPDATE ON "economic_loss_coverages"
  FOR EACH ROW EXECUTE FUNCTION stage12_exception_children_append_only();

DROP TRIGGER IF EXISTS stage12_coverage_append_only_del_trg ON "economic_loss_coverages";
CREATE TRIGGER stage12_coverage_append_only_del_trg
  BEFORE DELETE ON "economic_loss_coverages"
  FOR EACH ROW EXECUTE FUNCTION stage12_exception_children_append_only();

-- VerifiedFact is immutable once concluded (no UPDATE, no DELETE).
CREATE OR REPLACE FUNCTION stage12_verified_fact_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage12_verified_fact_immutable: % of verified_facts is forbidden',
    TG_OP
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_verified_fact_immutable_upd_trg ON "verified_facts";
CREATE TRIGGER stage12_verified_fact_immutable_upd_trg
  BEFORE UPDATE ON "verified_facts"
  FOR EACH ROW EXECUTE FUNCTION stage12_verified_fact_immutable();

DROP TRIGGER IF EXISTS stage12_verified_fact_immutable_del_trg ON "verified_facts";
CREATE TRIGGER stage12_verified_fact_immutable_del_trg
  BEFORE DELETE ON "verified_facts"
  FOR EACH ROW EXECUTE FUNCTION stage12_verified_fact_immutable();

-- Claims: DELETE forbidden; terminal claims immutable.
CREATE OR REPLACE FUNCTION stage12_exception_claim_no_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage12_exception_claim_no_delete: DELETE of exception_claims is forbidden'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_exception_claim_no_delete_trg ON "exception_claims";
CREATE TRIGGER stage12_exception_claim_no_delete_trg
  BEFORE DELETE ON "exception_claims"
  FOR EACH ROW EXECUTE FUNCTION stage12_exception_claim_no_delete();

CREATE OR REPLACE FUNCTION stage12_exception_claim_terminal_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('FINALIZED', 'REJECTED', 'WITHDRAWN', 'CANCELLED') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.claim_type IS DISTINCT FROM OLD.claim_type
       OR NEW.subject_ref IS DISTINCT FROM OLD.subject_ref
       OR NEW.economic_loss_id IS DISTINCT FROM OLD.economic_loss_id
       OR NEW.operations_recovery_id IS DISTINCT FROM OLD.operations_recovery_id
       OR NEW.wk_order_id IS DISTINCT FROM OLD.wk_order_id
       OR NEW.fulfillment_id IS DISTINCT FROM OLD.fulfillment_id
       OR NEW.claimed_amount IS DISTINCT FROM OLD.claimed_amount
       OR NEW.policy_version_id IS DISTINCT FROM OLD.policy_version_id
       OR NEW.policy_hash IS DISTINCT FROM OLD.policy_hash
       OR NEW.terminal_reason IS DISTINCT FROM OLD.terminal_reason
    THEN
      RAISE EXCEPTION 'stage12_exception_claim_terminal_immutable: terminal claim % cannot be mutated',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_exception_claim_terminal_immutable_trg ON "exception_claims";
CREATE TRIGGER stage12_exception_claim_terminal_immutable_trg
  BEFORE UPDATE ON "exception_claims"
  FOR EACH ROW EXECUTE FUNCTION stage12_exception_claim_terminal_immutable();

-- FINALIZED determinations are immutable; DELETE always forbidden.
CREATE OR REPLACE FUNCTION stage12_determination_no_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage12_determination_no_delete: DELETE of liability_determinations is forbidden'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_determination_no_delete_trg ON "liability_determinations";
CREATE TRIGGER stage12_determination_no_delete_trg
  BEFORE DELETE ON "liability_determinations"
  FOR EACH ROW EXECUTE FUNCTION stage12_determination_no_delete();

CREATE OR REPLACE FUNCTION stage12_determination_finalized_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'FINALIZED' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.total_liability_amount IS DISTINCT FROM OLD.total_liability_amount
       OR NEW.exception_claim_id IS DISTINCT FROM OLD.exception_claim_id
       OR NEW.economic_loss_id IS DISTINCT FROM OLD.economic_loss_id
       OR NEW.policy_version_id IS DISTINCT FROM OLD.policy_version_id
       OR NEW.policy_hash IS DISTINCT FROM OLD.policy_hash
       OR NEW.compensable_amount_snapshot IS DISTINCT FROM OLD.compensable_amount_snapshot
       OR NEW.prior_coverage_amount_snapshot IS DISTINCT FROM OLD.prior_coverage_amount_snapshot
       OR NEW.remaining_amount_snapshot IS DISTINCT FROM OLD.remaining_amount_snapshot
       OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at
       OR NEW.finalized_by_actor_id IS DISTINCT FROM OLD.finalized_by_actor_id
       OR NEW.adjustment_of_determination_id IS DISTINCT FROM OLD.adjustment_of_determination_id
    THEN
      RAISE EXCEPTION 'stage12_determination_finalized_immutable: finalized determination % cannot be mutated',
        OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_determination_finalized_immutable_trg ON "liability_determinations";
CREATE TRIGGER stage12_determination_finalized_immutable_trg
  BEFORE UPDATE ON "liability_determinations"
  FOR EACH ROW EXECUTE FUNCTION stage12_determination_finalized_immutable();

-- Allocation sum must equal the determination total at finalize time, and the
-- total must fit inside the remaining (uncovered) compensable amount.
CREATE OR REPLACE FUNCTION stage12_determination_allocation_sum_on_finalize()
RETURNS trigger AS $$
DECLARE
  alloc_sum NUMERIC(14,2);
  alloc_count INTEGER;
BEGIN
  IF NEW.status = 'FINALIZED' AND OLD.status IS DISTINCT FROM 'FINALIZED' THEN
    SELECT COALESCE(SUM(amount), 0), COUNT(*)
      INTO alloc_sum, alloc_count
      FROM liability_allocations
     WHERE liability_determination_id = NEW.id;

    IF alloc_count = 0 THEN
      RAISE EXCEPTION 'stage12_allocation_sum: determination % has no allocations', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF alloc_sum <> NEW.total_liability_amount THEN
      RAISE EXCEPTION 'stage12_allocation_sum: allocations (%) <> total_liability_amount (%) for determination %',
        alloc_sum, NEW.total_liability_amount, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.remaining_amount_snapshot IS NULL
       OR NEW.total_liability_amount > NEW.remaining_amount_snapshot THEN
      RAISE EXCEPTION 'stage12_allocation_sum: total_liability_amount (%) exceeds remaining (%) for determination %',
        NEW.total_liability_amount, NEW.remaining_amount_snapshot, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_determination_allocation_sum_trg ON "liability_determinations";
CREATE TRIGGER stage12_determination_allocation_sum_trg
  BEFORE UPDATE ON "liability_determinations"
  FOR EACH ROW EXECUTE FUNCTION stage12_determination_allocation_sum_on_finalize();

-- Allocations are frozen once their determination is FINALIZED, and PLATFORM
-- can never be introduced as a liable party.
CREATE OR REPLACE FUNCTION stage12_allocation_guard()
RETURNS trigger AS $$
DECLARE
  det_status TEXT;
  row_party TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status::text INTO det_status
      FROM liability_determinations
     WHERE id = OLD.liability_determination_id;
    IF det_status = 'FINALIZED' THEN
      RAISE EXCEPTION 'stage12_allocation_guard: allocations of finalized determination % are immutable',
        OLD.liability_determination_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  row_party := NEW.party_type::text;
  IF row_party = 'PLATFORM' THEN
    RAISE EXCEPTION 'stage12_allocation_guard: PLATFORM is never a liable party'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT status::text INTO det_status
    FROM liability_determinations
   WHERE id = NEW.liability_determination_id;
  IF det_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'stage12_allocation_guard: allocations of finalized determination % are immutable',
      NEW.liability_determination_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_allocation_guard_ins_trg ON "liability_allocations";
CREATE TRIGGER stage12_allocation_guard_ins_trg
  BEFORE INSERT ON "liability_allocations"
  FOR EACH ROW EXECUTE FUNCTION stage12_allocation_guard();

DROP TRIGGER IF EXISTS stage12_allocation_guard_upd_trg ON "liability_allocations";
CREATE TRIGGER stage12_allocation_guard_upd_trg
  BEFORE UPDATE ON "liability_allocations"
  FOR EACH ROW EXECUTE FUNCTION stage12_allocation_guard();

DROP TRIGGER IF EXISTS stage12_allocation_guard_del_trg ON "liability_allocations";
CREATE TRIGGER stage12_allocation_guard_del_trg
  BEFORE DELETE ON "liability_allocations"
  FOR EACH ROW EXECUTE FUNCTION stage12_allocation_guard();

-- PLATFORM can never be a Stage 12 obligation debtor or creditor.
CREATE OR REPLACE FUNCTION stage12_obligation_reject_platform()
RETURNS trigger AS $$
BEGIN
  IF NEW.debtor_type::text = 'PLATFORM' OR NEW.creditor_type::text = 'PLATFORM' THEN
    RAISE EXCEPTION 'stage12_obligation_reject_platform: PLATFORM is never an exception obligation party'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_obligation_reject_platform_trg ON "exception_financial_obligations";
CREATE TRIGGER stage12_obligation_reject_platform_trg
  BEFORE INSERT OR UPDATE ON "exception_financial_obligations"
  FOR EACH ROW EXECUTE FUNCTION stage12_obligation_reject_platform();

-- Obligations are never deleted; only status-transitioned.
CREATE OR REPLACE FUNCTION stage12_obligation_no_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage12_obligation_no_delete: DELETE of exception_financial_obligations is forbidden'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_obligation_no_delete_trg ON "exception_financial_obligations";
CREATE TRIGGER stage12_obligation_no_delete_trg
  BEFORE DELETE ON "exception_financial_obligations"
  FOR EACH ROW EXECUTE FUNCTION stage12_obligation_no_delete();

-- Coverage ceiling: total coverage may never exceed the compensable amount.
-- This is the double-recovery backstop that holds even if application code
-- (Stage 9 import + Stage 12 obligations) races.
CREATE OR REPLACE FUNCTION stage12_coverage_ceiling()
RETURNS trigger AS $$
DECLARE
  compensable NUMERIC(14,2);
  covered NUMERIC(14,2);
  loss_currency VARCHAR(3);
BEGIN
  SELECT compensable_amount, currency
    INTO compensable, loss_currency
    FROM economic_losses
   WHERE id = NEW.economic_loss_id
   FOR UPDATE;

  IF compensable IS NULL THEN
    RAISE EXCEPTION 'stage12_coverage_ceiling: economic loss % not found', NEW.economic_loss_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.currency <> loss_currency THEN
    RAISE EXCEPTION 'stage12_coverage_ceiling: coverage currency % <> loss currency %',
      NEW.currency, loss_currency
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO covered
    FROM economic_loss_coverages
   WHERE economic_loss_id = NEW.economic_loss_id;

  IF covered + NEW.amount > compensable THEN
    RAISE EXCEPTION 'stage12_coverage_ceiling: coverage % + % exceeds compensable % for economic loss %',
      covered, NEW.amount, compensable, NEW.economic_loss_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_coverage_ceiling_trg ON "economic_loss_coverages";
CREATE TRIGGER stage12_coverage_ceiling_trg
  BEFORE INSERT ON "economic_loss_coverages"
  FOR EACH ROW EXECUTE FUNCTION stage12_coverage_ceiling();

-- Economic losses are never deleted, and compensable/subject identity is frozen
-- once any coverage exists.
CREATE OR REPLACE FUNCTION stage12_economic_loss_guard()
RETURNS trigger AS $$
DECLARE
  coverage_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stage12_economic_loss_guard: DELETE of economic_losses is forbidden'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.economic_loss_key IS DISTINCT FROM OLD.economic_loss_key
     OR NEW.wk_order_id IS DISTINCT FROM OLD.wk_order_id
     OR NEW.loss_kind IS DISTINCT FROM OLD.loss_kind
     OR NEW.subject_ref IS DISTINCT FROM OLD.subject_ref THEN
    RAISE EXCEPTION 'stage12_economic_loss_guard: economic loss identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.compensable_amount IS DISTINCT FROM OLD.compensable_amount THEN
    SELECT COUNT(*) INTO coverage_count
      FROM economic_loss_coverages
     WHERE economic_loss_id = OLD.id;
    IF coverage_count > 0 THEN
      RAISE EXCEPTION 'stage12_economic_loss_guard: compensable_amount frozen once coverage exists'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage12_economic_loss_guard_upd_trg ON "economic_losses";
CREATE TRIGGER stage12_economic_loss_guard_upd_trg
  BEFORE UPDATE ON "economic_losses"
  FOR EACH ROW EXECUTE FUNCTION stage12_economic_loss_guard();

DROP TRIGGER IF EXISTS stage12_economic_loss_guard_del_trg ON "economic_losses";
CREATE TRIGGER stage12_economic_loss_guard_del_trg
  BEFORE DELETE ON "economic_losses"
  FOR EACH ROW EXECUTE FUNCTION stage12_economic_loss_guard();
