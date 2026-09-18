-- Stage 13A: Exception Obligation Settlement Foundation (additive)
-- Rollback: see rollback.sql
-- Frozen parent = Stage 12. No Stage 5B/9/12 financial rails are altered here.
-- Settlement writes apply ONLY to ExceptionFinancialObligation.
-- Also includes Stage13 prerequisite integrity hardening of
-- exception_financial_obligations (immutable economic identity) and
-- Stage13 prerequisite executability-authority hardening of status.
-- That hardening is not a Stage12 semantic change.

DO $$ BEGIN
  CREATE TYPE "ExceptionFinancialSettlementMethod" AS ENUM (
    'CASH',
    'DIRECT_TRANSFER',
    'BANK_TRANSFER',
    'MERCHANT_QR'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExceptionFinancialSettlementStatus" AS ENUM (
    'CLAIMED',
    'ACKNOWLEDGED',
    'REJECTED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExceptionFinancialSettlementEvidenceKind" AS ENUM (
    'TRANSFER_RECEIPT',
    'BANK_REFERENCE',
    'QR_RECEIPT',
    'CASH_RECEIPT_REFERENCE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── exception_financial_settlements ───────────────────────────────────

CREATE TABLE IF NOT EXISTS "exception_financial_settlements" (
  "id" UUID NOT NULL,
  "obligation_id" UUID NOT NULL,
  "wk_order_id" INTEGER NOT NULL,
  "debtor_type_snapshot" "ExceptionLiablePartyType" NOT NULL,
  "debtor_user_id_snapshot" UUID,
  "debtor_merchant_id_snapshot" INTEGER,
  "creditor_type_snapshot" "ExceptionLiablePartyType" NOT NULL,
  "creditor_user_id_snapshot" UUID,
  "creditor_merchant_id_snapshot" INTEGER,
  "method" "ExceptionFinancialSettlementMethod" NOT NULL,
  "status" "ExceptionFinancialSettlementStatus" NOT NULL DEFAULT 'CLAIMED',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PHP',
  "claimed_amount" DECIMAL(14,2),
  "acknowledged_amount" DECIMAL(14,2),
  "external_reference" VARCHAR(120),
  "claimed_by_type" "OrderDomainActorType" NOT NULL,
  "claimed_by_id" UUID NOT NULL,
  "claimed_at" TIMESTAMPTZ NOT NULL,
  "acknowledged_by_type" "OrderDomainActorType",
  "acknowledged_by_id" UUID,
  "acknowledged_at" TIMESTAMPTZ,
  "rejected_by_type" "OrderDomainActorType",
  "rejected_by_id" UUID,
  "rejected_at" TIMESTAMPTZ,
  "cancelled_by_type" "OrderDomainActorType",
  "cancelled_by_id" UUID,
  "cancelled_at" TIMESTAMPTZ,
  "rejection_reason" VARCHAR(255),
  "claim_idempotency_key" VARCHAR(64),
  "ack_idempotency_key" VARCHAR(64),
  "cash_idempotency_key" VARCHAR(64),
  "reject_idempotency_key" VARCHAR(64),
  "cancel_idempotency_key" VARCHAR(64),
  "payload_fingerprint" VARCHAR(64),
  "correlation_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exception_financial_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "exception_financial_settlements_claimed_positive_check"
    CHECK ("claimed_amount" IS NULL OR "claimed_amount" > 0),
  CONSTRAINT "exception_financial_settlements_ack_positive_check"
    CHECK ("acknowledged_amount" IS NULL OR "acknowledged_amount" > 0),
  CONSTRAINT "exception_financial_settlements_debtor_binding_check"
    CHECK (
      ("debtor_type_snapshot" = 'MERCHANT' AND "debtor_merchant_id_snapshot" IS NOT NULL AND "debtor_user_id_snapshot" IS NULL)
      OR
      ("debtor_type_snapshot" <> 'MERCHANT' AND "debtor_user_id_snapshot" IS NOT NULL AND "debtor_merchant_id_snapshot" IS NULL)
    ),
  CONSTRAINT "exception_financial_settlements_creditor_binding_check"
    CHECK (
      ("creditor_type_snapshot" = 'MERCHANT' AND "creditor_merchant_id_snapshot" IS NOT NULL AND "creditor_user_id_snapshot" IS NULL)
      OR
      ("creditor_type_snapshot" <> 'MERCHANT' AND "creditor_user_id_snapshot" IS NOT NULL AND "creditor_merchant_id_snapshot" IS NULL)
    ),
  CONSTRAINT "exception_financial_settlements_distinct_parties_check"
    CHECK (
      "debtor_type_snapshot" IS DISTINCT FROM "creditor_type_snapshot"
      OR "debtor_user_id_snapshot" IS DISTINCT FROM "creditor_user_id_snapshot"
      OR "debtor_merchant_id_snapshot" IS DISTINCT FROM "creditor_merchant_id_snapshot"
    ),
  CONSTRAINT "exception_financial_settlements_ack_requires_amount_check"
    CHECK (
      ("status" <> 'ACKNOWLEDGED')
      OR ("acknowledged_amount" IS NOT NULL AND "acknowledged_amount" > 0)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "exception_financial_settlements_claim_idempotency_key_key"
  ON "exception_financial_settlements"("claim_idempotency_key")
  WHERE "claim_idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "exception_financial_settlements_ack_idempotency_key_key"
  ON "exception_financial_settlements"("ack_idempotency_key")
  WHERE "ack_idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "exception_financial_settlements_cash_idempotency_key_key"
  ON "exception_financial_settlements"("cash_idempotency_key")
  WHERE "cash_idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "exception_financial_settlements_reject_idempotency_key_key"
  ON "exception_financial_settlements"("reject_idempotency_key")
  WHERE "reject_idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "exception_financial_settlements_cancel_idempotency_key_key"
  ON "exception_financial_settlements"("cancel_idempotency_key")
  WHERE "cancel_idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "exception_financial_settlements_obligation_id_status_idx"
  ON "exception_financial_settlements"("obligation_id", "status");
CREATE INDEX IF NOT EXISTS "exception_financial_settlements_wk_order_id_status_idx"
  ON "exception_financial_settlements"("wk_order_id", "status");

DO $$ BEGIN
  ALTER TABLE "exception_financial_settlements"
    ADD CONSTRAINT "exception_financial_settlements_obligation_id_fkey"
    FOREIGN KEY ("obligation_id") REFERENCES "exception_financial_obligations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_settlements"
    ADD CONSTRAINT "exception_financial_settlements_wk_order_id_fkey"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_settlements"
    ADD CONSTRAINT "exception_financial_settlements_claimed_by_id_fkey"
    FOREIGN KEY ("claimed_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_settlements"
    ADD CONSTRAINT "exception_financial_settlements_acknowledged_by_id_fkey"
    FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_settlements"
    ADD CONSTRAINT "exception_financial_settlements_rejected_by_id_fkey"
    FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_settlements"
    ADD CONSTRAINT "exception_financial_settlements_cancelled_by_id_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── exception_financial_settlement_evidence ───────────────────────────

CREATE TABLE IF NOT EXISTS "exception_financial_settlement_evidence" (
  "id" UUID NOT NULL,
  "settlement_id" UUID NOT NULL,
  "kind" "ExceptionFinancialSettlementEvidenceKind" NOT NULL,
  "storage_reference" VARCHAR(1000) NOT NULL,
  "note" VARCHAR(2000),
  "uploaded_by_type" "OrderDomainActorType" NOT NULL,
  "uploaded_by_id" UUID NOT NULL,
  "correlation_id" VARCHAR(64),
  "idempotency_key" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exception_financial_settlement_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "exception_financial_settlement_evidence_idempotency_key_key"
  ON "exception_financial_settlement_evidence"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "exception_financial_settlement_evidence_settlement_id_created_at_idx"
  ON "exception_financial_settlement_evidence"("settlement_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "exception_financial_settlement_evidence"
    ADD CONSTRAINT "exception_financial_settlement_evidence_settlement_id_fkey"
    FOREIGN KEY ("settlement_id") REFERENCES "exception_financial_settlements"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "exception_financial_settlement_evidence"
    ADD CONSTRAINT "exception_financial_settlement_evidence_uploaded_by_id_fkey"
    FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Overpayment defense: Σ ACK <= obligation.principal ────────────────

CREATE OR REPLACE FUNCTION stage13a_exception_settlement_overpayment_guard()
RETURNS trigger AS $$
DECLARE
  v_principal DECIMAL(14,2);
  v_ack_sum DECIMAL(14,2);
  v_obligation_id UUID;
BEGIN
  v_obligation_id := COALESCE(NEW.obligation_id, OLD.obligation_id);

  SELECT principal INTO v_principal
  FROM "exception_financial_obligations"
  WHERE id = v_obligation_id
  FOR UPDATE;

  IF v_principal IS NULL THEN
    RAISE EXCEPTION 'stage13a_exception_settlement_overpayment: obligation % not found', v_obligation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT COALESCE(SUM("acknowledged_amount"), 0) INTO v_ack_sum
  FROM "exception_financial_settlements"
  WHERE "obligation_id" = v_obligation_id
    AND "status" = 'ACKNOWLEDGED';

  IF v_ack_sum > v_principal THEN
    RAISE EXCEPTION
      'stage13a_exception_settlement_overpayment: ACK sum % exceeds principal % for obligation %',
      v_ack_sum, v_principal, v_obligation_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage13a_efs_overpayment_ins_trg ON "exception_financial_settlements";
CREATE CONSTRAINT TRIGGER stage13a_efs_overpayment_ins_trg
  AFTER INSERT ON "exception_financial_settlements"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  WHEN (NEW.status = 'ACKNOWLEDGED')
  EXECUTE FUNCTION stage13a_exception_settlement_overpayment_guard();

DROP TRIGGER IF EXISTS stage13a_efs_overpayment_upd_trg ON "exception_financial_settlements";
CREATE CONSTRAINT TRIGGER stage13a_efs_overpayment_upd_trg
  AFTER UPDATE OF status, acknowledged_amount, obligation_id ON "exception_financial_settlements"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  WHEN (NEW.status = 'ACKNOWLEDGED' OR OLD.status = 'ACKNOWLEDGED')
  EXECUTE FUNCTION stage13a_exception_settlement_overpayment_guard();

-- ─── Terminal immutability ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION stage13a_exception_settlement_immutable_guard()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('ACKNOWLEDGED', 'REJECTED', 'CANCELLED') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.method IS DISTINCT FROM OLD.method
       OR NEW.claimed_amount IS DISTINCT FROM OLD.claimed_amount
       OR NEW.acknowledged_amount IS DISTINCT FROM OLD.acknowledged_amount
       OR NEW.obligation_id IS DISTINCT FROM OLD.obligation_id
       OR NEW.wk_order_id IS DISTINCT FROM OLD.wk_order_id
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
       OR NEW.debtor_type_snapshot IS DISTINCT FROM OLD.debtor_type_snapshot
       OR NEW.debtor_user_id_snapshot IS DISTINCT FROM OLD.debtor_user_id_snapshot
       OR NEW.debtor_merchant_id_snapshot IS DISTINCT FROM OLD.debtor_merchant_id_snapshot
       OR NEW.creditor_type_snapshot IS DISTINCT FROM OLD.creditor_type_snapshot
       OR NEW.creditor_user_id_snapshot IS DISTINCT FROM OLD.creditor_user_id_snapshot
       OR NEW.creditor_merchant_id_snapshot IS DISTINCT FROM OLD.creditor_merchant_id_snapshot
       OR NEW.claimed_by_type IS DISTINCT FROM OLD.claimed_by_type
       OR NEW.claimed_by_id IS DISTINCT FROM OLD.claimed_by_id
       OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
       OR NEW.acknowledged_by_type IS DISTINCT FROM OLD.acknowledged_by_type
       OR NEW.acknowledged_by_id IS DISTINCT FROM OLD.acknowledged_by_id
       OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
       OR NEW.rejected_by_type IS DISTINCT FROM OLD.rejected_by_type
       OR NEW.rejected_by_id IS DISTINCT FROM OLD.rejected_by_id
       OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
       OR NEW.cancelled_by_type IS DISTINCT FROM OLD.cancelled_by_type
       OR NEW.cancelled_by_id IS DISTINCT FROM OLD.cancelled_by_id
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
    THEN
      RAISE EXCEPTION 'stage13a_exception_settlement_immutable: terminal settlement financial fields cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage13a_efs_immutable_trg ON "exception_financial_settlements";
CREATE TRIGGER stage13a_efs_immutable_trg
  BEFORE UPDATE ON "exception_financial_settlements"
  FOR EACH ROW
  EXECUTE FUNCTION stage13a_exception_settlement_immutable_guard();

CREATE OR REPLACE FUNCTION stage13a_exception_settlement_no_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage13a_exception_settlement_no_delete: DELETE of exception_financial_settlements is forbidden'
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage13a_efs_no_delete_trg ON "exception_financial_settlements";
CREATE TRIGGER stage13a_efs_no_delete_trg
  BEFORE DELETE ON "exception_financial_settlements"
  FOR EACH ROW
  EXECUTE FUNCTION stage13a_exception_settlement_no_delete();

-- ─── Evidence append-only ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION stage13a_exception_settlement_evidence_immutable_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage13a_exception_settlement_evidence_immutable: evidence rows cannot be updated'
    USING ERRCODE = 'check_violation';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage13a_efse_immutable_upd_trg ON "exception_financial_settlement_evidence";
CREATE TRIGGER stage13a_efse_immutable_upd_trg
  BEFORE UPDATE ON "exception_financial_settlement_evidence"
  FOR EACH ROW
  EXECUTE FUNCTION stage13a_exception_settlement_evidence_immutable_guard();

CREATE OR REPLACE FUNCTION stage13a_exception_settlement_evidence_no_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage13a_exception_settlement_evidence_no_delete: DELETE of settlement evidence is forbidden'
    USING ERRCODE = 'check_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage13a_efse_no_delete_trg ON "exception_financial_settlement_evidence";
CREATE TRIGGER stage13a_efse_no_delete_trg
  BEFORE DELETE ON "exception_financial_settlement_evidence"
  FOR EACH ROW
  EXECUTE FUNCTION stage13a_exception_settlement_evidence_no_delete();

-- ─── Platform firewall on settlement snapshots ─────────────────────────
-- ExceptionLiablePartyType has no PLATFORM member; this rejects any future
-- cast abuse / unexpected label that would imply platform custody.

CREATE OR REPLACE FUNCTION stage13a_exception_settlement_reject_platform()
RETURNS trigger AS $$
BEGIN
  IF NEW.debtor_type_snapshot::text = 'PLATFORM'
     OR NEW.creditor_type_snapshot::text = 'PLATFORM' THEN
    RAISE EXCEPTION 'stage13a_exception_settlement_reject_platform: PLATFORM is never a settlement party'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage13a_efs_reject_platform_trg ON "exception_financial_settlements";
CREATE TRIGGER stage13a_efs_reject_platform_trg
  BEFORE INSERT OR UPDATE ON "exception_financial_settlements"
  FOR EACH ROW
  EXECUTE FUNCTION stage13a_exception_settlement_reject_platform();

-- ─── Stage13 prerequisite integrity hardening ──────────────────────────
-- ExceptionFinancialObligation is an immutable financial authority once
-- created. Stage13 execution now depends on this existing Stage12 table
-- as an immutable financial contract. This is additive Stage13A
-- prerequisite integrity hardening — NOT a Stage12 semantic change.
-- Frozen Stage12 historical migration is not modified.
--
-- Economic identity / source bindings / relation identity / creation
-- provenance cannot be rewritten after INSERT.
-- status remains mutable for the non-authoritative OPEN /
-- PARTIALLY_SETTLED / SETTLED ops mirror. updated_at remains a
-- technical timestamp. DELETE remains forbidden by the existing
-- Stage12 trigger stage12_obligation_no_delete (not duplicated).

CREATE OR REPLACE FUNCTION stage13a_exception_obligation_economic_identity_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.liability_determination_id IS DISTINCT FROM OLD.liability_determination_id
     OR NEW.exception_claim_id IS DISTINCT FROM OLD.exception_claim_id
     OR NEW.economic_loss_id IS DISTINCT FROM OLD.economic_loss_id
     OR NEW.wk_order_id IS DISTINCT FROM OLD.wk_order_id
     OR NEW.debtor_type IS DISTINCT FROM OLD.debtor_type
     OR NEW.debtor_user_id IS DISTINCT FROM OLD.debtor_user_id
     OR NEW.debtor_merchant_id IS DISTINCT FROM OLD.debtor_merchant_id
     OR NEW.creditor_type IS DISTINCT FROM OLD.creditor_type
     OR NEW.creditor_user_id IS DISTINCT FROM OLD.creditor_user_id
     OR NEW.creditor_merchant_id IS DISTINCT FROM OLD.creditor_merchant_id
     OR NEW.principal IS DISTINCT FROM OLD.principal
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'stage13a_exception_obligation_immutable: economic identity of exception_financial_obligations cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage13a_efo_economic_identity_trg ON "exception_financial_obligations";
CREATE TRIGGER stage13a_efo_economic_identity_trg
  BEFORE UPDATE ON "exception_financial_obligations"
  FOR EACH ROW
  EXECUTE FUNCTION stage13a_exception_obligation_economic_identity_guard();

-- ─── Stage13 prerequisite executability-authority hardening ───────────
-- ExceptionFinancialObligation.status is not a free-form ops field.
-- CANCELLED / WRITTEN_OFF change Stage13 executability
-- (OBLIGATION_NOT_EXECUTABLE) but have NO current authoritative
-- product workflow in Stage12 or Stage13A. Fail closed: those states
-- cannot be inserted or transitioned into/out of.
--
-- OPEN / PARTIALLY_SETTLED / SETTLED may be persisted only as the
-- derived settlement mirror required by frozen Stage12
-- EXCEPTION_OBLIGATION_PENDING (OPEN|PARTIALLY_SETTLED). The persisted
-- value must match Σ ACKNOWLEDGED vs principal. Financial authority
-- remains immutable principal minus Σ ACK, not this column.
-- This is not a Stage12 semantic change.

CREATE OR REPLACE FUNCTION stage13a_exception_obligation_status_authority_guard()
RETURNS trigger AS $$
DECLARE
  v_ack DECIMAL(14,2);
  v_principal DECIMAL(14,2);
  v_expected TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text IS DISTINCT FROM 'OPEN' THEN
      RAISE EXCEPTION 'stage13a_exception_obligation_status_authority: INSERT status must be OPEN'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status::text IS NOT DISTINCT FROM OLD.status::text THEN
    RETURN NEW;
  END IF;

  IF OLD.status::text IN ('CANCELLED', 'WRITTEN_OFF')
     OR NEW.status::text IN ('CANCELLED', 'WRITTEN_OFF') THEN
    RAISE EXCEPTION 'stage13a_exception_obligation_status_authority: CANCELLED/WRITTEN_OFF is not an authorized transition'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status::text NOT IN ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED') THEN
    RAISE EXCEPTION 'stage13a_exception_obligation_status_authority: status % is not an authorized settlement mirror',
      NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  v_principal := NEW.principal;
  SELECT COALESCE(SUM(acknowledged_amount), 0) INTO v_ack
    FROM exception_financial_settlements
   WHERE obligation_id = NEW.id
     AND status = 'ACKNOWLEDGED';

  IF v_ack <= 0 THEN
    v_expected := 'OPEN';
  ELSIF v_ack >= v_principal THEN
    v_expected := 'SETTLED';
  ELSE
    v_expected := 'PARTIALLY_SETTLED';
  END IF;

  IF NEW.status::text IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION
      'stage13a_exception_obligation_status_authority: status % does not match derived settlement state % (ack % principal %)',
      NEW.status, v_expected, v_ack, v_principal
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage13a_efo_status_authority_trg ON "exception_financial_obligations";
CREATE TRIGGER stage13a_efo_status_authority_trg
  BEFORE INSERT OR UPDATE ON "exception_financial_obligations"
  FOR EACH ROW
  EXECUTE FUNCTION stage13a_exception_obligation_status_authority_guard();
