-- Stage15C READ-ONLY production topology preflight.
-- Run against the intended target immediately before applying
-- 20260921200000_stage15c_successor_chain_authority.
--
-- IF ANY INCOMPATIBLE ROW EXISTS:
--   DO NOT APPLY STAGE15C MIGRATION.
--   DATA REMEDIATION DESIGN REQUIRED.
--
-- This script:
--   MUST be READ ONLY
--   MUST NOT contain credentials
--   MUST NOT INSERT/UPDATE/DELETE/DDL
--   MUST NOT be run as an implicit "repair"
--
-- Usage (operator supplies a local psql connection; never embed passwords):
--   BEGIN;
--   SET TRANSACTION READ ONLY;
--   \i scripts/stage15c-production-topology-preflight.sql
--   ROLLBACK;

SELECT current_database() AS db, current_user AS usr;

SELECT COUNT(*) AS duplicate_parent_groups
FROM (
  SELECT adjustment_of_determination_id
  FROM liability_determinations
  WHERE adjustment_of_determination_id IS NOT NULL
  GROUP BY adjustment_of_determination_id
  HAVING COUNT(*) > 1
) s;

SELECT COUNT(*) AS self_parent
FROM liability_determinations
WHERE id = adjustment_of_determination_id;

SELECT COUNT(*) AS missing_parent
FROM liability_determinations c
LEFT JOIN liability_determinations p ON p.id = c.adjustment_of_determination_id
WHERE c.adjustment_of_determination_id IS NOT NULL AND p.id IS NULL;

SELECT COUNT(*) AS cross_claim
FROM liability_determinations c
JOIN liability_determinations p ON p.id = c.adjustment_of_determination_id
WHERE c.exception_claim_id <> p.exception_claim_id;

WITH RECURSIVE walk AS (
  SELECT
    id AS start_id,
    adjustment_of_determination_id AS parent_id,
    1 AS depth,
    ARRAY[id] AS path,
    false AS cycled
  FROM liability_determinations
  UNION ALL
  SELECT
    w.start_id,
    d.adjustment_of_determination_id,
    w.depth + 1,
    w.path || d.id,
    d.id = ANY (w.path)
  FROM walk w
  JOIN liability_determinations d ON d.id = w.parent_id
  WHERE w.depth < 64 AND NOT w.cycled AND w.parent_id IS NOT NULL
)
SELECT COUNT(DISTINCT start_id) AS cycle_starts
FROM walk
WHERE cycled;

SELECT COUNT(*) AS branch_parents
FROM (
  SELECT adjustment_of_determination_id
  FROM liability_determinations
  WHERE adjustment_of_determination_id IS NOT NULL
  GROUP BY 1
  HAVING COUNT(*) > 1
) s;

SELECT COUNT(*) AS non_finalized_parent_with_child
FROM liability_determinations c
JOIN liability_determinations p ON p.id = c.adjustment_of_determination_id
WHERE p.status <> 'FINALIZED';

SELECT COUNT(*) AS claims_gt1_active
FROM (
  SELECT exception_claim_id
  FROM liability_determinations
  WHERE status IN ('DRAFT', 'PROPOSED')
  GROUP BY 1
  HAVING COUNT(*) > 1
) s;
