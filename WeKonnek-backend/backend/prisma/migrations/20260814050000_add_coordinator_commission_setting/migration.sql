CREATE TABLE "coordinator_commission_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "coordinator_commission_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "coordinator_commission_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100)
);

INSERT INTO "coordinator_commission_settings" ("id", "rate") VALUES (1, 0)
ON CONFLICT ("id") DO NOTHING;
