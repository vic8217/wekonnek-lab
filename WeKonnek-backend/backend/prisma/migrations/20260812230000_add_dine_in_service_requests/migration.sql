CREATE TABLE "dine_in_service_requests" (
  "id" SERIAL NOT NULL,
  "order_id" INTEGER NOT NULL,
  "shop_id" INTEGER NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "details" VARCHAR(250),
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "assigned_staff_id" INTEGER,
  "assigned_at" TIMESTAMPTZ,
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dine_in_service_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dine_in_service_requests_shop_id_status_created_at_idx" ON "dine_in_service_requests"("shop_id", "status", "created_at");
CREATE INDEX "dine_in_service_requests_order_id_created_at_idx" ON "dine_in_service_requests"("order_id", "created_at");
CREATE INDEX "dine_in_service_requests_assigned_staff_id_status_idx" ON "dine_in_service_requests"("assigned_staff_id", "status");

ALTER TABLE "dine_in_service_requests" ADD CONSTRAINT "dine_in_service_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;
ALTER TABLE "dine_in_service_requests" ADD CONSTRAINT "dine_in_service_requests_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "branches"("id") ON DELETE CASCADE;
ALTER TABLE "dine_in_service_requests" ADD CONSTRAINT "dine_in_service_requests_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "merchant_staff"("id") ON DELETE SET NULL;
