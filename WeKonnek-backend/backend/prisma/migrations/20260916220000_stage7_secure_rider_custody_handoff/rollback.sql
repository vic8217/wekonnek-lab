-- Rollback for 20260916220000_stage7_secure_rider_custody_handoff
--
-- STRUCTURAL ROLLBACK: REQUIRED
-- ENUM LABEL REVERSAL: NOT REQUIRED (known PostgreSQL limitation)
--
-- This script MUST remove Stage 7 tables, columns, indexes, constraints, and
-- Stage 7-owned types used only by the handoff capability.
--
-- Residual CustodyEventType labels RIDER_TRANSFER_RELEASED /
-- RIDER_TRANSFER_RECEIVED are IRREVERSIBLE SCHEMA RESIDUE and are ACCEPTABLE.
-- Do NOT rebuild CustodyEventType solely to drop those labels.
-- Residual labels confer no authority; application authorization remains
-- authoritative (public custody APIs must still reject transfer events).
-- See docs/adr/0008-secure-rider-custody-handoff.md.

ALTER TABLE "rider_custody_handoff_tokens" DROP CONSTRAINT IF EXISTS "rider_custody_handoff_tokens_receipt_custody_event_id_fkey";
ALTER TABLE "rider_custody_handoff_tokens" DROP CONSTRAINT IF EXISTS "rider_custody_handoff_tokens_release_custody_event_id_fkey";
ALTER TABLE "rider_custody_handoff_tokens" DROP CONSTRAINT IF EXISTS "rider_custody_handoff_tokens_source_rider_assignment_id_fkey";
ALTER TABLE "rider_custody_handoff_tokens" DROP CONSTRAINT IF EXISTS "rider_custody_handoff_tokens_incoming_rider_id_fkey";
ALTER TABLE "rider_custody_handoff_tokens" DROP CONSTRAINT IF EXISTS "rider_custody_handoff_tokens_outgoing_rider_id_fkey";
ALTER TABLE "rider_custody_handoff_tokens" DROP CONSTRAINT IF EXISTS "rider_custody_handoff_tokens_fulfillment_id_fkey";
ALTER TABLE "rider_custody_handoff_tokens" DROP CONSTRAINT IF EXISTS "rider_custody_handoff_tokens_wk_order_id_fkey";

DROP TABLE IF EXISTS "rider_custody_handoff_tokens";
DROP TYPE IF EXISTS "RiderCustodyHandoffTokenStatus";
DROP TYPE IF EXISTS "RiderCustodyHandoffPurpose";

DROP INDEX IF EXISTS "order_fulfillments_physical_custodian_rider_id_status_idx";

ALTER TABLE "order_fulfillments" DROP CONSTRAINT IF EXISTS "order_fulfillments_pending_custody_incoming_rider_id_fkey";
ALTER TABLE "order_fulfillments" DROP CONSTRAINT IF EXISTS "order_fulfillments_physical_custodian_rider_id_fkey";

ALTER TABLE "order_fulfillments"
  DROP COLUMN IF EXISTS "pending_custody_requested_at",
  DROP COLUMN IF EXISTS "pending_custody_from_assignment_version",
  DROP COLUMN IF EXISTS "pending_custody_incoming_rider_id",
  DROP COLUMN IF EXISTS "physical_custodian_rider_id";

-- Intentionally retained after rollback (unsafe ordinary DROP VALUE):
--   CustodyEventType.RIDER_TRANSFER_RELEASED
--   CustodyEventType.RIDER_TRANSFER_RECEIVED
-- Forward migration uses ADD VALUE IF NOT EXISTS so reapply succeeds.
