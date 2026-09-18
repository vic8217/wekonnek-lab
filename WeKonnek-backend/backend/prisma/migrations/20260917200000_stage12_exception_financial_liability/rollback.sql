-- Stage 12 rollback — drops Stage 12–owned objects only.
-- Stage 9 / 11 objects are untouched.

DROP TRIGGER IF EXISTS stage12_economic_loss_guard_del_trg ON "economic_losses";
DROP TRIGGER IF EXISTS stage12_economic_loss_guard_upd_trg ON "economic_losses";
DROP TRIGGER IF EXISTS stage12_coverage_ceiling_trg ON "economic_loss_coverages";
DROP TRIGGER IF EXISTS stage12_obligation_no_delete_trg ON "exception_financial_obligations";
DROP TRIGGER IF EXISTS stage12_obligation_reject_platform_trg ON "exception_financial_obligations";
DROP TRIGGER IF EXISTS stage12_allocation_guard_del_trg ON "liability_allocations";
DROP TRIGGER IF EXISTS stage12_allocation_guard_upd_trg ON "liability_allocations";
DROP TRIGGER IF EXISTS stage12_allocation_guard_ins_trg ON "liability_allocations";
DROP TRIGGER IF EXISTS stage12_determination_allocation_sum_trg ON "liability_determinations";
DROP TRIGGER IF EXISTS stage12_determination_finalized_immutable_trg ON "liability_determinations";
DROP TRIGGER IF EXISTS stage12_determination_no_delete_trg ON "liability_determinations";
DROP TRIGGER IF EXISTS stage12_exception_claim_terminal_immutable_trg ON "exception_claims";
DROP TRIGGER IF EXISTS stage12_exception_claim_no_delete_trg ON "exception_claims";
DROP TRIGGER IF EXISTS stage12_verified_fact_immutable_del_trg ON "verified_facts";
DROP TRIGGER IF EXISTS stage12_verified_fact_immutable_upd_trg ON "verified_facts";
DROP TRIGGER IF EXISTS stage12_coverage_append_only_del_trg ON "economic_loss_coverages";
DROP TRIGGER IF EXISTS stage12_coverage_append_only_upd_trg ON "economic_loss_coverages";
DROP TRIGGER IF EXISTS stage12_claim_verifications_append_only_del_trg ON "exception_claim_verifications";
DROP TRIGGER IF EXISTS stage12_claim_verifications_append_only_upd_trg ON "exception_claim_verifications";
DROP TRIGGER IF EXISTS stage12_claim_evidence_append_only_del_trg ON "exception_claim_evidence";
DROP TRIGGER IF EXISTS stage12_claim_evidence_append_only_upd_trg ON "exception_claim_evidence";
DROP TRIGGER IF EXISTS stage12_claim_events_append_only_del_trg ON "exception_claim_events";
DROP TRIGGER IF EXISTS stage12_claim_events_append_only_upd_trg ON "exception_claim_events";

DROP FUNCTION IF EXISTS stage12_economic_loss_guard();
DROP FUNCTION IF EXISTS stage12_coverage_ceiling();
DROP FUNCTION IF EXISTS stage12_obligation_no_delete();
DROP FUNCTION IF EXISTS stage12_obligation_reject_platform();
DROP FUNCTION IF EXISTS stage12_allocation_guard();
DROP FUNCTION IF EXISTS stage12_determination_allocation_sum_on_finalize();
DROP FUNCTION IF EXISTS stage12_determination_finalized_immutable();
DROP FUNCTION IF EXISTS stage12_determination_no_delete();
DROP FUNCTION IF EXISTS stage12_exception_claim_terminal_immutable();
DROP FUNCTION IF EXISTS stage12_exception_claim_no_delete();
DROP FUNCTION IF EXISTS stage12_verified_fact_immutable();
DROP FUNCTION IF EXISTS stage12_exception_children_append_only();

DROP TABLE IF EXISTS "exception_financial_obligations";
DROP TABLE IF EXISTS "liability_allocations";
DROP TABLE IF EXISTS "liability_determinations";
DROP TABLE IF EXISTS "verified_facts";
DROP TABLE IF EXISTS "exception_claim_verifications";
DROP TABLE IF EXISTS "exception_claim_evidence";
DROP TABLE IF EXISTS "exception_claim_events";
DROP TABLE IF EXISTS "exception_claims";
DROP TABLE IF EXISTS "economic_loss_coverages";
DROP TABLE IF EXISTS "economic_losses";
DROP TABLE IF EXISTS "exception_liability_policy_versions";

DROP TYPE IF EXISTS "ExceptionClaimEventType";
DROP TYPE IF EXISTS "ExceptionLiabilityPolicyStatus";
DROP TYPE IF EXISTS "ExceptionFinancialObligationStatus";
DROP TYPE IF EXISTS "ExceptionLiablePartyType";
DROP TYPE IF EXISTS "LiabilityDeterminationStatus";
DROP TYPE IF EXISTS "VerifiedFactType";
DROP TYPE IF EXISTS "ClaimVerificationStatus";
DROP TYPE IF EXISTS "ClaimEvidenceKind";
DROP TYPE IF EXISTS "ClaimEvidenceVisibility";
DROP TYPE IF EXISTS "ExceptionClaimStatus";
DROP TYPE IF EXISTS "ExceptionClaimType";
DROP TYPE IF EXISTS "GoodsNonConformanceReasonCode";
DROP TYPE IF EXISTS "EconomicLossCoverageSourceKind";
DROP TYPE IF EXISTS "EconomicLossKind";
