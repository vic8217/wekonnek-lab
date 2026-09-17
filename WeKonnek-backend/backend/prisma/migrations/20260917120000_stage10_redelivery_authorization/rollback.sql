-- Stage 10 rollback — drops Stage 10–owned objects only.

DROP TRIGGER IF EXISTS stage10_redelivery_terminal_immutable_trg ON "redelivery_authorizations";
DROP TRIGGER IF EXISTS stage10_redelivery_append_only_del_trg ON "redelivery_authorizations";
DROP FUNCTION IF EXISTS stage10_redelivery_terminal_immutable();
DROP FUNCTION IF EXISTS stage10_redelivery_append_only_del();

DROP TABLE IF EXISTS "redelivery_authorizations";

DROP TYPE IF EXISTS "RedeliveryCustomerAuthMethod";
DROP TYPE IF EXISTS "RedeliveryAddressMode";
DROP TYPE IF EXISTS "RedeliveryAuthorizationStatus";
