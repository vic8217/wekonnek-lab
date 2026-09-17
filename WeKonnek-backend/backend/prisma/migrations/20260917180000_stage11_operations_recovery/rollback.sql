-- Stage 11 rollback — drops Stage 11–owned objects only.

DROP TRIGGER IF EXISTS stage11_operations_recovery_terminal_immutable_trg ON "operations_recoveries";
DROP TRIGGER IF EXISTS stage11_operations_recovery_append_only_del_trg ON "operations_recoveries";
DROP TRIGGER IF EXISTS stage11_ore_verifications_append_only_del_trg ON "operations_recovery_verifications";
DROP TRIGGER IF EXISTS stage11_ore_verifications_append_only_upd_trg ON "operations_recovery_verifications";
DROP TRIGGER IF EXISTS stage11_ore_evidence_append_only_del_trg ON "operations_recovery_evidence";
DROP TRIGGER IF EXISTS stage11_ore_evidence_append_only_upd_trg ON "operations_recovery_evidence";
DROP TRIGGER IF EXISTS stage11_ore_events_append_only_del_trg ON "operations_recovery_events";
DROP TRIGGER IF EXISTS stage11_ore_events_append_only_upd_trg ON "operations_recovery_events";

DROP FUNCTION IF EXISTS stage11_operations_recovery_terminal_immutable();
DROP FUNCTION IF EXISTS stage11_operations_recovery_append_only_del();
DROP FUNCTION IF EXISTS stage11_operations_recovery_children_append_only();

DROP TABLE IF EXISTS "operations_recovery_verifications";
DROP TABLE IF EXISTS "operations_recovery_evidence";
DROP TABLE IF EXISTS "operations_recovery_events";
DROP TABLE IF EXISTS "operations_recoveries";

DROP TYPE IF EXISTS "OperationsRecoveryVerificationCode";
DROP TYPE IF EXISTS "OperationsRecoveryEvidenceKind";
DROP TYPE IF EXISTS "OperationsRecoveryEventType";
DROP TYPE IF EXISTS "OperationsRecoveryDisposition";
DROP TYPE IF EXISTS "OperationsRecoveryTrigger";
DROP TYPE IF EXISTS "OperationsRecoveryStatus";
