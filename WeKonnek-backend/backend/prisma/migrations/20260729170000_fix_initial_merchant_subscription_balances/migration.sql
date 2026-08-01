WITH initial_bills AS (
  SELECT
    sp.id,
    ma.subscription_amount
      + COALESCE((
          SELECT SUM(sa.amount)
          FROM subscription_add_on_packages sa
          WHERE sa.id = ANY(ma.selected_add_on_ids)
        ), 0) AS total_amount
  FROM subscription_payments sp
  JOIN merchants m ON m.id = sp.merchant_id
  JOIN merchant_applications ma ON ma.merchant_code = m.merchant_code
  WHERE sp.payment_method = 'manual'
    AND sp.payment_ref IS NULL
    AND sp.gateway IS NULL
    AND sp.created_at <= m.created_at + INTERVAL '5 minutes'
)
UPDATE subscription_payments sp
SET status = 'pending',
    amount = initial_bills.total_amount,
    updated_at = CURRENT_TIMESTAMP
FROM initial_bills
WHERE sp.id = initial_bills.id;
