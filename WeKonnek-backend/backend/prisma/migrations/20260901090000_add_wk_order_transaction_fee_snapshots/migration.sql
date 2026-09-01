ALTER TABLE "orders"
  ADD COLUMN "transaction_fee_rate" DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN "transaction_fee_basis_net_of_vat" DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN "transaction_fee_amount" DECIMAL(10, 2) NOT NULL DEFAULT 0.00;
