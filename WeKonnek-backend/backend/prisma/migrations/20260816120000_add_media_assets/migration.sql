CREATE TABLE "media_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "media_type" VARCHAR(50) NOT NULL,
  "owner_type" VARCHAR(50) NOT NULL,
  "owner_id" VARCHAR(100) NOT NULL,
  "object_key" VARCHAR(500) NOT NULL,
  "thumbnail_key" VARCHAR(500),
  "url" VARCHAR(1000) NOT NULL,
  "thumbnail_url" VARCHAR(1000),
  "mime_type" VARCHAR(100) NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "size_bytes" INTEGER,
  "thumbnail_width" INTEGER,
  "thumbnail_height" INTEGER,
  "thumbnail_size_bytes" INTEGER,
  "status" VARCHAR(30) NOT NULL DEFAULT 'active',
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ,
  CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "media_assets_object_key_key" ON "media_assets"("object_key");
CREATE INDEX "media_assets_owner_type_owner_id_idx" ON "media_assets"("owner_type", "owner_id");
CREATE INDEX "media_assets_media_type_idx" ON "media_assets"("media_type");
CREATE INDEX "media_assets_created_by_id_idx" ON "media_assets"("created_by_id");
CREATE INDEX "media_assets_deleted_at_idx" ON "media_assets"("deleted_at");
