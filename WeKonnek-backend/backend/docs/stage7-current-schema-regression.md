# Stage 7 current-schema regression acceptance policy
#
# Frozen historical acceptance DBs are never schema-upgraded to satisfy a newer
# Prisma client. Contaminated Stage 5/5B/6 DBs remain documented contaminated
# and must not be repaired during Stage 7.
#
# Each future stage uses:
#   A) dedicated stage acceptance DB (e.g. wekonnek_stage7_test)
#   B) disposable current-schema regression DB
#      (wekonnek_stage7_regression_test) or equivalent isolation
#
# Before every schema mutation against the regression DB:
#   SELECT current_database(), current_user;
# Required: wekonnek_stage7_regression_test
#
# See docs/adr/0008-secure-rider-custody-handoff.md
