DROP TRIGGER IF EXISTS stage14a_review_terminal_immutable_trg ON "financial_reconciliation_reviews";
DROP TRIGGER IF EXISTS stage14a_review_no_delete_trg ON "financial_reconciliation_reviews";
DROP TRIGGER IF EXISTS stage14a_review_notes_append_only_del_trg ON "financial_reconciliation_review_notes";
DROP TRIGGER IF EXISTS stage14a_review_notes_append_only_upd_trg ON "financial_reconciliation_review_notes";
DROP TRIGGER IF EXISTS stage14a_review_events_append_only_del_trg ON "financial_reconciliation_review_events";
DROP TRIGGER IF EXISTS stage14a_review_events_append_only_upd_trg ON "financial_reconciliation_review_events";

DROP FUNCTION IF EXISTS stage14a_review_terminal_immutable();
DROP FUNCTION IF EXISTS stage14a_review_no_delete();
DROP FUNCTION IF EXISTS stage14a_review_children_append_only();

DROP TABLE IF EXISTS "financial_reconciliation_review_notes";
DROP TABLE IF EXISTS "financial_reconciliation_review_events";
DROP TABLE IF EXISTS "financial_reconciliation_reviews";

DROP TYPE IF EXISTS "FinancialReconciliationReviewEventType";
DROP TYPE IF EXISTS "FinancialReconciliationReviewWaitingParty";
DROP TYPE IF EXISTS "FinancialReconciliationReviewRoute";
DROP TYPE IF EXISTS "FinancialReconciliationReviewStatus";
