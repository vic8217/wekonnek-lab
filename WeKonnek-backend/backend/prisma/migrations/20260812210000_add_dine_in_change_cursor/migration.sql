CREATE TABLE "dine_in_changes" (
  "id" BIGSERIAL NOT NULL,
  "shop_id" INTEGER NOT NULL,
  "type" VARCHAR(60) NOT NULL,
  "entity_id" VARCHAR(100),
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dine_in_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dine_in_changes_shop_id_id_idx" ON "dine_in_changes"("shop_id", "id");
ALTER TABLE "dine_in_changes" ADD CONSTRAINT "dine_in_changes_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "branches"("id") ON DELETE CASCADE;
