UPDATE "users" AS u
SET "role" = 'coordinator'::"UserRole"
FROM "coordinator_applications" AS ca
WHERE ca."user_id" = u."id";
