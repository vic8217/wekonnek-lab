-- Rollback Stage 13A exception obligation settlement (destructive on Stage13A objects only).
-- Stage13 prerequisite integrity / executability-authority hardening is
-- dropped here; Stage12 obligation DELETE protection is left intact.

DROP TRIGGER IF EXISTS stage13a_efo_status_authority_trg ON "exception_financial_obligations";
DROP FUNCTION IF EXISTS stage13a_exception_obligation_status_authority_guard();

DROP TRIGGER IF EXISTS stage13a_efo_economic_identity_trg ON "exception_financial_obligations";
DROP FUNCTION IF EXISTS stage13a_exception_obligation_economic_identity_guard();

DROP TRIGGER IF EXISTS stage13a_efs_reject_platform_trg ON "exception_financial_settlements";
DROP FUNCTION IF EXISTS stage13a_exception_settlement_reject_platform();

DROP TRIGGER IF EXISTS stage13a_efse_no_delete_trg ON "exception_financial_settlement_evidence";
DROP FUNCTION IF EXISTS stage13a_exception_settlement_evidence_no_delete();

DROP TRIGGER IF EXISTS stage13a_efse_immutable_upd_trg ON "exception_financial_settlement_evidence";
DROP FUNCTION IF EXISTS stage13a_exception_settlement_evidence_immutable_guard();

DROP TRIGGER IF EXISTS stage13a_efs_no_delete_trg ON "exception_financial_settlements";
DROP FUNCTION IF EXISTS stage13a_exception_settlement_no_delete();

DROP TRIGGER IF EXISTS stage13a_efs_immutable_trg ON "exception_financial_settlements";
DROP FUNCTION IF EXISTS stage13a_exception_settlement_immutable_guard();

DROP TRIGGER IF EXISTS stage13a_efs_overpayment_upd_trg ON "exception_financial_settlements";
DROP TRIGGER IF EXISTS stage13a_efs_overpayment_ins_trg ON "exception_financial_settlements";
DROP FUNCTION IF EXISTS stage13a_exception_settlement_overpayment_guard();

DROP TABLE IF EXISTS "exception_financial_settlement_evidence";
DROP TABLE IF EXISTS "exception_financial_settlements";

DROP TYPE IF EXISTS "ExceptionFinancialSettlementEvidenceKind";
DROP TYPE IF EXISTS "ExceptionFinancialSettlementStatus";
DROP TYPE IF EXISTS "ExceptionFinancialSettlementMethod";
