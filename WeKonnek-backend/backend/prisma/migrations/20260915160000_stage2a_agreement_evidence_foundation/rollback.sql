-- Rollback for 20260915160000_stage2a_agreement_evidence_foundation
-- Prefer application rollback before dropping with dependents.

ALTER TABLE "trust_trade_transactions" DROP CONSTRAINT IF EXISTS "trust_trade_transactions_agreement_id_fkey";
ALTER TABLE "trust_trade_transactions" DROP COLUMN IF EXISTS "agreement_id";

DROP TABLE IF EXISTS "custody_event_evidences";
DROP TABLE IF EXISTS "custody_events";
DROP TABLE IF EXISTS "agreement_evidences";
DROP TABLE IF EXISTS "agreement_acceptances";
DROP TABLE IF EXISTS "agreement_parties";
ALTER TABLE "agreements" DROP CONSTRAINT IF EXISTS "agreements_current_version_id_fkey";
DROP TABLE IF EXISTS "agreement_versions";
DROP TABLE IF EXISTS "agreements";

DROP TYPE IF EXISTS "CustodyEventType";
DROP TYPE IF EXISTS "AgreementEvidenceType";
DROP TYPE IF EXISTS "AgreementProvenance";
DROP TYPE IF EXISTS "AgreementAcceptanceMethod";
DROP TYPE IF EXISTS "AgreementPartyRole";
DROP TYPE IF EXISTS "AgreementVersionStatus";
DROP TYPE IF EXISTS "AgreementStatus";
DROP TYPE IF EXISTS "AgreementType";
-- Note: enum value AGREEMENT on OrderDomainAggregateType is not removed (PG limitation).
