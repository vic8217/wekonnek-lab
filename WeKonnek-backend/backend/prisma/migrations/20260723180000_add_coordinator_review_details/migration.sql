ALTER TABLE "coordinator_applications"
ADD COLUMN "government_id_front_url" VARCHAR(500),
ADD COLUMN "government_id_back_url" VARCHAR(500),
ADD COLUMN "resume_url" VARCHAR(500),
ADD COLUMN "supporting_document_url" VARCHAR(500),
ADD COLUMN "admin_notes" TEXT;
