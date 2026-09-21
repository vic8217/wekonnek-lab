-- Stage15C: one child ever per parent. Additive unique index only.
-- No data rewrite, backfill, deletion, or status mutation.
-- Incompatible duplicate children cause this statement to FAIL.
-- Rollback: see rollback.sql

CREATE UNIQUE INDEX "liability_determinations_one_child_per_parent"
ON "liability_determinations"
("adjustment_of_determination_id")
WHERE "adjustment_of_determination_id" IS NOT NULL;
