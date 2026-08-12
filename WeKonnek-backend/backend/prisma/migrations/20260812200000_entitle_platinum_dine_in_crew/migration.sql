-- Assign the capability in subscription configuration. Application code still
-- authorizes solely by feature entitlement, never by the plan/tier name.
UPDATE "subscription_plan_definitions"
SET "features" = array_append("features", 'DINE_IN_CREW'),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "audience" = 'merchant'
  AND lower("tier") = 'platinum'
  AND NOT ('DINE_IN_CREW' = ANY("features"));
