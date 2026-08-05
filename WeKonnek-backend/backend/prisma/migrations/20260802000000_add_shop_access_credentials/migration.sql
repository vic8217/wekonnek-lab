ALTER TABLE "branches"
  ADD COLUMN "shop_id" VARCHAR(80),
  ADD COLUMN "passkey" VARCHAR(100),
  ADD COLUMN "passkey_expires_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX "branches_shop_id_key" ON "branches"("shop_id");
