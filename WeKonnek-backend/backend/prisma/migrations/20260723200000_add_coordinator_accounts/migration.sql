ALTER TABLE "coordinator_applications"
ADD COLUMN "coordinator_code" VARCHAR(30),
ADD COLUMN "user_id" UUID,
ADD COLUMN "reset_token_hash" VARCHAR(64),
ADD COLUMN "reset_token_expires_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX "coordinator_applications_coordinator_code_key"
ON "coordinator_applications"("coordinator_code");

CREATE UNIQUE INDEX "coordinator_applications_user_id_key"
ON "coordinator_applications"("user_id");
