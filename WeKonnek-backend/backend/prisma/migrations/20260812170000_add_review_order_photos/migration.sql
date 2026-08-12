ALTER TABLE "reviews" ADD COLUMN "order_id" TEXT;
ALTER TABLE "reviews" ADD COLUMN "photo_urls" JSONB;
CREATE INDEX "reviews_order_id_idx" ON "reviews"("order_id");
CREATE UNIQUE INDEX "reviews_user_id_order_id_key" ON "reviews"("user_id", "order_id");
