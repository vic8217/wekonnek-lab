ALTER TABLE "users"
ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" u
SET "must_change_password" = true
FROM "merchant_applications" ma
WHERE ma.user_id = u.id
  AND ma.status = 'approved'
  AND ma.temporary_password IS NOT NULL;
