-- Rollback for 20260916230000_stage8_delivery_failure_operational_case
--
-- STRUCTURAL ROLLBACK: REQUIRED
-- Removes Stage 8 tables, indexes, constraints, triggers, functions, and
-- Stage 8-owned enum types.
--
-- Residue after rollback: NONE expected for Stage 8–owned objects.
-- Frozen Stage 0–7 tables/columns/types are intentionally untouched.
-- See docs/adr/0009-delivery-failure-operational-case.md.

DROP TRIGGER IF EXISTS stage8_operational_case_events_append_only_del_trg ON "operational_case_events";
DROP TRIGGER IF EXISTS stage8_operational_case_events_append_only_upd_trg ON "operational_case_events";
DROP FUNCTION IF EXISTS stage8_operational_case_events_append_only_guard();

DROP TRIGGER IF EXISTS stage8_delivery_attempt_evidences_append_only_del_trg ON "delivery_attempt_evidences";
DROP TRIGGER IF EXISTS stage8_delivery_attempt_evidences_append_only_upd_trg ON "delivery_attempt_evidences";
DROP FUNCTION IF EXISTS stage8_delivery_attempt_evidences_append_only_guard();

DROP TRIGGER IF EXISTS stage8_delivery_attempts_append_only_del_trg ON "delivery_attempts";
DROP TRIGGER IF EXISTS stage8_delivery_attempts_append_only_upd_trg ON "delivery_attempts";
DROP FUNCTION IF EXISTS stage8_delivery_attempts_append_only_guard();

DROP TABLE IF EXISTS "operational_case_events";
DROP TABLE IF EXISTS "operational_cases";
DROP TABLE IF EXISTS "delivery_attempt_evidences";
DROP TABLE IF EXISTS "delivery_attempts";

DROP TYPE IF EXISTS "OperationalCaseEventType";
DROP TYPE IF EXISTS "OperationalDisposition";
DROP TYPE IF EXISTS "OperationalCaseStatus";
DROP TYPE IF EXISTS "OperationalCaseType";
DROP TYPE IF EXISTS "DeliveryAttemptEvidenceKind";
DROP TYPE IF EXISTS "DeliveryAttemptLocationProvenance";
DROP TYPE IF EXISTS "DeliveryAttemptCustomerResponse";
DROP TYPE IF EXISTS "DeliveryFailureReasonCode";
DROP TYPE IF EXISTS "DeliveryAttemptOutcome";

-- Intentionally retained after rollback: none (Stage 8 owns its enums/tables).
-- Forward reapply uses CREATE TYPE / CREATE TABLE IF NOT EXISTS so reapply succeeds.
