ALTER TABLE "products" ADD COLUMN "notes" JSONB NOT NULL DEFAULT '[]'::jsonb;
