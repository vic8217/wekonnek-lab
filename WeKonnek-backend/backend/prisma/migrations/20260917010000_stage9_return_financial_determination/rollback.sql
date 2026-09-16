-- Rollback for 20260917010000_stage9_return_financial_determination
--
-- STRUCTURAL ROLLBACK: REQUIRED
-- Removes Stage 9 tables, indexes, constraints, triggers, functions, and
-- Stage 9-owned enum types.
--
-- Residue after rollback: NONE expected for Stage 9–owned objects.
-- Frozen Stage 0–8 tables/columns/types are intentionally untouched.
-- See docs/adr/0010-return-financial-determination.md.

DROP TRIGGER IF EXISTS stage9_racr_append_only_del_trg ON "rider_advance_collection_restrictions";
DROP FUNCTION IF EXISTS stage9_ra_collection_restriction_append_only_guard();
DROP TRIGGER IF EXISTS stage9_racr_integrity_trg ON "rider_advance_collection_restrictions";
DROP FUNCTION IF EXISTS stage9_ra_collection_restriction_integrity_guard();

DROP TRIGGER IF EXISTS stage9_rfs_append_only_del_trg ON "return_financial_settlements";
DROP FUNCTION IF EXISTS stage9_return_financial_settlement_append_only_guard();

DROP TRIGGER IF EXISTS stage9_rfs_immutable_trg ON "return_financial_settlements";
DROP FUNCTION IF EXISTS stage9_return_financial_settlement_immutable_guard();

DROP TRIGGER IF EXISTS stage9_rfd_immutable_trg ON "return_financial_determinations";
DROP FUNCTION IF EXISTS stage9_return_financial_determination_immutable_guard();
DROP TRIGGER IF EXISTS stage9_rfd_append_only_del_trg ON "return_financial_determinations";
DROP FUNCTION IF EXISTS stage9_return_financial_determination_append_only_guard();

DROP TABLE IF EXISTS "rider_advance_collection_restrictions";
DROP TABLE IF EXISTS "return_financial_settlements";
DROP TABLE IF EXISTS "return_financial_obligations";
DROP TABLE IF EXISTS "return_financial_determinations";
DROP TABLE IF EXISTS "return_financial_terms_acceptances";
DROP TABLE IF EXISTS "return_financial_terms_versions";

DROP TYPE IF EXISTS "ReturnFinancialTermsKind";
DROP TYPE IF EXISTS "RiderAdvanceCollectionRestrictionStatus";
DROP TYPE IF EXISTS "RiderAdvanceCollectionRestrictionEffect";
DROP TYPE IF EXISTS "ReturnFinancialPartyType";
DROP TYPE IF EXISTS "ReturnFinancialSettlementStatus";
DROP TYPE IF EXISTS "ReturnFinancialSettlementMethod";
DROP TYPE IF EXISTS "ReturnFinancialObligationStatus";
DROP TYPE IF EXISTS "ReturnFinancialObligationType";
DROP TYPE IF EXISTS "ReturnFinancialDeterminationOutcome";
DROP TYPE IF EXISTS "ReturnFinancialDeterminationStatus";

-- Intentionally retained after rollback: none (Stage 9 owns its enums/tables).
-- Forward reapply uses CREATE TYPE / CREATE TABLE IF NOT EXISTS so reapply succeeds.
