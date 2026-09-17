/**
 * Stage 8+ append-only fixture isolation (harness only).
 *
 * Production triggers forbid UPDATE/DELETE on delivery_attempts and Stage 9
 * financial history. Test afterEach must NOT disable triggers or delete
 * protected rows. Isolation = unique fixture IDs (UUID phone/email/orderCode)
 * + optional fresh disposable Stage 11 current-schema DB per complete suite run.
 */
export const APPEND_ONLY_HISTORY_TABLES = [
  'delivery_attempts',
  'delivery_attempt_evidences',
  'operational_case_events',
  'return_financial_settlements',
  'return_financial_determinations',
  'rider_advance_collection_restrictions',
  'rider_advance_settlements',
] as const;

/** Patterns that must not appear in Stage 8/10 redelivery postgres fixture cleanup. */
export const FORBIDDEN_APPEND_ONLY_CLEANUP_PATTERNS = [
  /deliveryAttempt\.deleteMany/,
  /delivery_attempts\.deleteMany/i,
  /DISABLE\s+TRIGGER\s+stage8_delivery_attempts/i,
  /DISABLE\s+TRIGGER\s+stage8_operational_case_events/i,
] as const;

/**
 * Patterns forbidden in Stage 9 return-financial *fixture cleanup* sources
 * (postgres.spec / http.int.spec). Production-role negative assertions that
 * expect app-role DISABLE/DROP to fail live in a different file and are
 * intentionally out of scope.
 */
export const FORBIDDEN_STAGE9_FIXTURE_CLEANUP_PATTERNS = [
  /DISABLE\s+TRIGGER\s+USER/i,
  /DISABLE\s+TRIGGER\s+ALL/i,
  /DISABLE\s+TRIGGER\s+stage9_/i,
  /session_replication_role/i,
  /DROP\s+TRIGGER/i,
  /returnFinancialSettlement\.deleteMany/,
  /returnFinancialDetermination\.deleteMany/,
  /riderAdvanceCollectionRestriction\.deleteMany/,
  /riderAdvanceSettlement\.deleteMany/,
  /return_financial_settlements\.deleteMany/i,
  /return_financial_determinations\.deleteMany/i,
] as const;
