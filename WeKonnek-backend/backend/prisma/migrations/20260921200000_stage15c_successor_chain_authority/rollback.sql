-- Stage15C rollback. Drop the one-child-per-parent index only.
DROP INDEX IF EXISTS "liability_determinations_one_child_per_parent";
