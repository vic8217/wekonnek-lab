-- Stage 4: wallet money precision, PIN hash, typed ledger audit columns.
-- Existing float values are cast to numeric then rounded to 2 decimal places.
-- Values that were already 2dp (the expected production shape) are preserved.
-- Sub-cent float artifacts, if any, round to the nearest cent.

ALTER TABLE "wallets"
  ALTER COLUMN "balance" TYPE DECIMAL(14,2)
  USING ROUND(("balance")::numeric, 2);

ALTER TABLE "wallets"
  ALTER COLUMN "balance" SET DEFAULT 0.00;

ALTER TABLE "wallets"
  ADD COLUMN "pin_hash" TEXT,
  ADD COLUMN "pin_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pin_locked_until" TIMESTAMP(3);

ALTER TABLE "wallet_transactions"
  ALTER COLUMN "amount" TYPE DECIMAL(14,2)
  USING ROUND(("amount")::numeric, 2);

ALTER TABLE "wallet_transactions"
  ALTER COLUMN "fee" TYPE DECIMAL(14,2)
  USING ROUND(("fee")::numeric, 2);

ALTER TABLE "wallet_transactions"
  ALTER COLUMN "fee" SET DEFAULT 0.00;

ALTER TABLE "wallet_transactions"
  ALTER COLUMN "net_amount" TYPE DECIMAL(14,2)
  USING ROUND(("net_amount")::numeric, 2);

ALTER TABLE "wallet_transactions"
  ALTER COLUMN "net_amount" SET DEFAULT 0.00;

ALTER TABLE "wallet_transactions"
  ADD COLUMN "balance_before" DECIMAL(14,2),
  ADD COLUMN "balance_after" DECIMAL(14,2),
  ADD COLUMN "idempotency_key" VARCHAR(80),
  ADD COLUMN "purpose" VARCHAR(50),
  ADD COLUMN "actor_user_id" UUID;

CREATE UNIQUE INDEX "wallet_transactions_wallet_id_type_idempotency_key_key"
  ON "wallet_transactions" ("wallet_id", "type", "idempotency_key");
