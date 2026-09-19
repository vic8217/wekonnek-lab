-- Stage14A: operational financial reconciliation review.
-- Does not alter frozen financial rail tables except review-side FKs.

CREATE TYPE "FinancialReconciliationReviewStatus" AS ENUM (
  'OPEN',
  'IN_REVIEW',
  'WAITING_ON_PARTY',
  'ESCALATED_ENGINEERING',
  'CLOSED_CONDITION_CLEARED',
  'CLOSED_REVIEW_ONLY',
  'CLOSED_DUPLICATE'
);

CREATE TYPE "FinancialReconciliationReviewRoute" AS ENUM (
  'ENGINEERING',
  'WAITING_ON_PARTY',
  'STAGE12_REVIEW',
  'REVIEW_ONLY'
);

CREATE TYPE "FinancialReconciliationReviewWaitingParty" AS ENUM (
  'CUSTOMER',
  'MERCHANT',
  'RIDER'
);

CREATE TYPE "FinancialReconciliationReviewEventType" AS ENUM (
  'REVIEW_OPENED',
  'ASSIGNED',
  'UNASSIGNED',
  'NOTE_ADDED',
  'ROUTE_CLASSIFIED',
  'WAITING_ON_PARTY',
  'ESCALATED_ENGINEERING',
  'LIVE_RECONCILIATION_REFRESHED',
  'STALE_FINDING_REJECTED',
  'CLOSED_CONDITION_CLEARED',
  'CLOSED_REVIEW_ONLY',
  'CLOSED_DUPLICATE',
  'NEW_CASE_FROM_REAPPEARANCE'
);

CREATE TABLE "financial_reconciliation_reviews" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "wk_order_id" INTEGER NOT NULL,
  "finding_key" VARCHAR(500) NOT NULL,
  "finding_code" VARCHAR(80) NOT NULL,
  "opening_fingerprint" VARCHAR(64) NOT NULL,
  "current_fingerprint" VARCHAR(64),
  "status" "FinancialReconciliationReviewStatus" NOT NULL,
  "assigned_admin_user_id" UUID,
  "route_classification" "FinancialReconciliationReviewRoute",
  "waiting_party_type" "FinancialReconciliationReviewWaitingParty",
  "close_classification" "FinancialReconciliationReviewStatus",
  "close_reason" VARCHAR(500),
  "prior_review_id" UUID,
  "row_version" INTEGER NOT NULL DEFAULT 1,
  "created_by_admin_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "closed_at" TIMESTAMPTZ,
  CONSTRAINT "financial_reconciliation_reviews_order_fk"
    FOREIGN KEY ("wk_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "financial_reconciliation_reviews_assignee_fk"
    FOREIGN KEY ("assigned_admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "financial_reconciliation_reviews_created_by_fk"
    FOREIGN KEY ("created_by_admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "financial_reconciliation_reviews_prior_fk"
    FOREIGN KEY ("prior_review_id") REFERENCES "financial_reconciliation_reviews"("id") ON DELETE RESTRICT
);

CREATE INDEX "financial_reconciliation_reviews_order_status_idx"
  ON "financial_reconciliation_reviews" ("wk_order_id", "status");
CREATE INDEX "financial_reconciliation_reviews_assignee_status_idx"
  ON "financial_reconciliation_reviews" ("assigned_admin_user_id", "status");
CREATE INDEX "financial_reconciliation_reviews_finding_created_idx"
  ON "financial_reconciliation_reviews" ("finding_code", "created_at");
CREATE INDEX "financial_reconciliation_reviews_created_idx"
  ON "financial_reconciliation_reviews" ("created_at");

CREATE UNIQUE INDEX "financial_reconciliation_reviews_open_finding_uq"
  ON "financial_reconciliation_reviews" ("wk_order_id", "finding_key")
  WHERE "status" IN ('OPEN', 'IN_REVIEW', 'WAITING_ON_PARTY', 'ESCALATED_ENGINEERING');

CREATE TABLE "financial_reconciliation_review_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "review_id" UUID NOT NULL,
  "type" "FinancialReconciliationReviewEventType" NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "actor_admin_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "financial_reconciliation_review_events_review_fk"
    FOREIGN KEY ("review_id") REFERENCES "financial_reconciliation_reviews"("id") ON DELETE RESTRICT
);

CREATE INDEX "financial_reconciliation_review_events_review_created_idx"
  ON "financial_reconciliation_review_events" ("review_id", "created_at");

CREATE TABLE "financial_reconciliation_review_notes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "review_id" UUID NOT NULL,
  "author_admin_user_id" UUID NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "idempotency_key" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "financial_reconciliation_review_notes_review_fk"
    FOREIGN KEY ("review_id") REFERENCES "financial_reconciliation_reviews"("id") ON DELETE RESTRICT,
  CONSTRAINT "financial_reconciliation_review_notes_author_fk"
    FOREIGN KEY ("author_admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "financial_reconciliation_review_notes_idempotency_uq"
  ON "financial_reconciliation_review_notes" ("review_id", "idempotency_key");
CREATE INDEX "financial_reconciliation_review_notes_review_created_idx"
  ON "financial_reconciliation_review_notes" ("review_id", "created_at");

CREATE OR REPLACE FUNCTION stage14a_review_children_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage14a_review_append_only: % of % is forbidden',
    TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage14a_review_events_append_only_upd_trg
  ON "financial_reconciliation_review_events";
CREATE TRIGGER stage14a_review_events_append_only_upd_trg
  BEFORE UPDATE ON "financial_reconciliation_review_events"
  FOR EACH ROW EXECUTE FUNCTION stage14a_review_children_append_only();

DROP TRIGGER IF EXISTS stage14a_review_events_append_only_del_trg
  ON "financial_reconciliation_review_events";
CREATE TRIGGER stage14a_review_events_append_only_del_trg
  BEFORE DELETE ON "financial_reconciliation_review_events"
  FOR EACH ROW EXECUTE FUNCTION stage14a_review_children_append_only();

DROP TRIGGER IF EXISTS stage14a_review_notes_append_only_upd_trg
  ON "financial_reconciliation_review_notes";
CREATE TRIGGER stage14a_review_notes_append_only_upd_trg
  BEFORE UPDATE ON "financial_reconciliation_review_notes"
  FOR EACH ROW EXECUTE FUNCTION stage14a_review_children_append_only();

DROP TRIGGER IF EXISTS stage14a_review_notes_append_only_del_trg
  ON "financial_reconciliation_review_notes";
CREATE TRIGGER stage14a_review_notes_append_only_del_trg
  BEFORE DELETE ON "financial_reconciliation_review_notes"
  FOR EACH ROW EXECUTE FUNCTION stage14a_review_children_append_only();

CREATE OR REPLACE FUNCTION stage14a_review_no_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stage14a_reviews_append_only: DELETE forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage14a_review_no_delete_trg
  ON "financial_reconciliation_reviews";
CREATE TRIGGER stage14a_review_no_delete_trg
  BEFORE DELETE ON "financial_reconciliation_reviews"
  FOR EACH ROW EXECUTE FUNCTION stage14a_review_no_delete();

CREATE OR REPLACE FUNCTION stage14a_review_terminal_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN (
    'CLOSED_CONDITION_CLEARED',
    'CLOSED_REVIEW_ONLY',
    'CLOSED_DUPLICATE'
  ) THEN
    RAISE EXCEPTION
      'stage14a_review_terminal_immutable: terminal review % cannot be mutated',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stage14a_review_terminal_immutable_trg
  ON "financial_reconciliation_reviews";
CREATE TRIGGER stage14a_review_terminal_immutable_trg
  BEFORE UPDATE ON "financial_reconciliation_reviews"
  FOR EACH ROW EXECUTE FUNCTION stage14a_review_terminal_immutable();
