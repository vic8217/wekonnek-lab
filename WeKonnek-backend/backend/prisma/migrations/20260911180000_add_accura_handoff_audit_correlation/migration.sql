-- Additive audit correlation id for ACCURA merchant handoff. No order or invoice rewrite.
ALTER TABLE "accura_onboarding_audit_events"
  ADD COLUMN "correlation_id" VARCHAR(80);
