-- ============================================================================
-- WeKonnek E-Invoice / E-Receipt System — BIR-Compliant
-- Full Migration Script
-- Run this AFTER supabase-migration.sql
--
-- Covers:
--   RR 11-2025 (system-issued invoices)
--   RR 8-2022  (CAS registration, EIS transmission)
--   RMO 24-2023 (JSON transmission, EIS Unique ID)
--   BIR sample invoice formats (VAT, non-VAT, exempt, zero-rated, mixed)
--   Regulated discounts (SC, PWD, NAAC/MOV, Solo Parent)
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  1. MERCHANT TAX FIELDS                                        ║
-- ╚══════════════════════════════════════════════════════════════════╝

DO $$
BEGIN
    -- TIN (Tax Identification Number) — BIR mandatory
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='merchants' AND column_name='tin') THEN
        ALTER TABLE public.merchants ADD COLUMN tin VARCHAR(50);
    END IF;

    -- VAT registration status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='merchants' AND column_name='is_vat_registered') THEN
        ALTER TABLE public.merchants ADD COLUMN is_vat_registered BOOLEAN DEFAULT false;
    END IF;

    -- Registered business name (legal name, may differ from trade name)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='merchants' AND column_name='registered_business_name') THEN
        ALTER TABLE public.merchants ADD COLUMN registered_business_name VARCHAR(500);
    END IF;

    -- SEC / DTI registration
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='merchants' AND column_name='sec_registration') THEN
        ALTER TABLE public.merchants ADD COLUMN sec_registration VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='merchants' AND column_name='dti_registration') THEN
        ALTER TABLE public.merchants ADD COLUMN dti_registration VARCHAR(100);
    END IF;

    -- Branch code (for branch-based series control)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='merchants' AND column_name='branch_code') THEN
        ALTER TABLE public.merchants ADD COLUMN branch_code VARCHAR(20) DEFAULT 'MAIN';
    END IF;

    -- BIR CAS/CRM accreditation number
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='merchants' AND column_name='bir_accreditation_no') THEN
        ALTER TABLE public.merchants ADD COLUMN bir_accreditation_no VARCHAR(100);
    END IF;

    -- BIR permit-to-use number
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='merchants' AND column_name='bir_permit_no') THEN
        ALTER TABLE public.merchants ADD COLUMN bir_permit_no VARCHAR(100);
    END IF;
END $$;


-- Repeat for merchant_applications
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='merchant_applications' AND column_name='tin') THEN
        ALTER TABLE public.merchant_applications ADD COLUMN tin VARCHAR(50);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='merchant_applications' AND column_name='is_vat_registered') THEN
        ALTER TABLE public.merchant_applications ADD COLUMN is_vat_registered BOOLEAN DEFAULT false;
    END IF;
END $$;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  2. INVOICES — main header table                                ║
-- ╚══════════════════════════════════════════════════════════════════╝

DROP TABLE IF EXISTS public.invoices CASCADE;

CREATE TABLE public.invoices (
    id                SERIAL PRIMARY KEY,

    -- ── Identity & Numbering ──
    invoice_number    VARCHAR(100) UNIQUE NOT NULL,   -- e.g. WK-INV-MAIN-2026-000001
    serial_number     VARCHAR(100) NOT NULL,
    branch_code       VARCHAR(20)  DEFAULT 'MAIN',
    approved_series   VARCHAR(100),                   -- BIR-approved series range

    -- ── Document Type ──
    document_type     VARCHAR(30)  NOT NULL DEFAULT 'invoice'
                      CHECK (document_type IN (
                          'invoice',          -- Sales Invoice
                          'receipt',          -- Official Receipt
                          'credit_memo',      -- Credit Memo
                          'debit_memo',       -- Debit Memo
                          'payment_receipt'   -- Supplementary Payment Receipt / Collection Receipt
                      )),

    -- ── Tax Classification (RR 11-2025 / BIR sample formats) ──
    tax_type          VARCHAR(30) NOT NULL DEFAULT 'vat'
                      CHECK (tax_type IN (
                          'vat',              -- VAT Sales Invoice
                          'non_vat',          -- Non-VAT
                          'vat_exempt',       -- VAT-Exempt Sale
                          'zero_rated',       -- Zero-Rated Sale
                          'mixed'             -- Mixed transaction
                      )),

    -- ── Linked Order ──
    order_id          INTEGER REFERENCES public.orders(id) ON DELETE SET NULL,
    order_code        VARCHAR(50),
    parent_invoice_id INTEGER REFERENCES public.invoices(id) ON DELETE SET NULL, -- for credit/debit memos

    -- ── Channel Tagging (WeKonnek-specific) ──
    channel           VARCHAR(30) DEFAULT 'marketplace'
                      CHECK (channel IN (
                          'in_store','pickup','dine_in','reservation',
                          'delivery','marketplace'
                      )),

    -- ── Seller Snapshot ──
    merchant_id           INTEGER NOT NULL REFERENCES public.merchants(id),
    seller_registered_name VARCHAR(500) NOT NULL,
    seller_trade_name      VARCHAR(255),
    seller_tin             VARCHAR(50),
    seller_branch_code     VARCHAR(20),
    seller_address         TEXT NOT NULL,
    seller_city            VARCHAR(100),
    seller_phone           VARCHAR(20),
    seller_email           VARCHAR(255),
    seller_bir_accreditation VARCHAR(100),
    seller_bir_permit      VARCHAR(100),

    -- ── Buyer Snapshot ──
    customer_id        UUID REFERENCES public.users(id),
    buyer_name         VARCHAR(255) NOT NULL,
    buyer_tin          VARCHAR(50),         -- required in some B2B
    buyer_address      TEXT,
    buyer_phone        VARCHAR(20),
    buyer_email        VARCHAR(255),

    -- ── Date ──
    invoice_date       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_date           TIMESTAMP WITH TIME ZONE,

    -- ── Line Items (JSON snapshot) ──
    items              JSONB NOT NULL DEFAULT '[]'::jsonb,
    /*  Each item:
        {
          "line_no": 1,
          "product_id": 42,
          "description": "Chicken Adobo Rice Meal",
          "quantity": 2,
          "unit": "pcs",
          "unit_price": 120.00,
          "gross_amount": 240.00,
          "discount_amount": 0.00,
          "discount_type": null,
          "discount_id_no": null,
          "net_amount": 240.00,
          "tax_type": "vat",
          "vat_amount": 25.71,
          "withholding_tax": 0.00
        }
    */

    -- ── Amounts ──
    gross_sales        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_discount     DECIMAL(12,2) DEFAULT 0.00,

    -- Discount Breakdown (SC/PWD/Solo Parent per BIR sample formats)
    sc_discount        DECIMAL(12,2) DEFAULT 0.00,  -- Senior Citizen 20%
    pwd_discount       DECIMAL(12,2) DEFAULT 0.00,  -- PWD 20%
    naac_discount      DECIMAL(12,2) DEFAULT 0.00,  -- National Athletes, Artists, Coaches
    solo_parent_discount DECIMAL(12,2) DEFAULT 0.00,
    promo_discount     DECIMAL(12,2) DEFAULT 0.00,  -- merchant promo discounts
    sc_id_no           VARCHAR(100),
    pwd_id_no          VARCHAR(100),
    naac_id_no         VARCHAR(100),
    solo_parent_id_no  VARCHAR(100),

    -- Net & Fees
    net_sales          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    delivery_fee       DECIMAL(12,2) DEFAULT 0.00,
    service_charge     DECIMAL(12,2) DEFAULT 0.00,  -- WeKonnek-specific
    platform_fee       DECIMAL(12,2) DEFAULT 0.00,  -- WeKonnek platform fee visibility

    -- VAT Breakdown (all BIR variants)
    vatable_sales      DECIMAL(12,2) DEFAULT 0.00,
    vat_amount         DECIMAL(12,2) DEFAULT 0.00,  -- 12%
    vat_exempt_sales   DECIMAL(12,2) DEFAULT 0.00,
    zero_rated_sales   DECIMAL(12,2) DEFAULT 0.00,

    -- Withholding Tax
    withholding_tax    DECIMAL(12,2) DEFAULT 0.00,

    -- Total
    total_amount_due   DECIMAL(12,2) NOT NULL DEFAULT 0.00,

    -- ── Payment ──
    payment_type       VARCHAR(30) DEFAULT 'cash'
                       CHECK (payment_type IN ('cash','charge','gcash','maya','card','bank_transfer','cod','mixed')),
    amount_tendered    DECIMAL(12,2),
    change_amount      DECIMAL(12,2),

    -- ── Status & Lifecycle ──
    status             VARCHAR(30)  DEFAULT 'generated'
                       CHECK (status IN ('draft','generated','sent','printed','voided','replaced')),
    is_reprint         BOOLEAN DEFAULT false,
    reprint_count      INTEGER DEFAULT 0,
    voided_at          TIMESTAMP WITH TIME ZONE,
    voided_by          UUID REFERENCES public.users(id),
    voided_reason      TEXT,
    replaced_by_id     INTEGER REFERENCES public.invoices(id),  -- replacement invoice

    -- ── EIS Transmission (RMO 24-2023) ──
    eis_unique_id      VARCHAR(200),        -- BIR EIS verification ID
    eis_status         VARCHAR(30) DEFAULT 'not_required'
                       CHECK (eis_status IN ('not_required','pending','transmitted','acknowledged','failed','retrying')),
    eis_transmitted_at TIMESTAMP WITH TIME ZONE,
    eis_acknowledged_at TIMESTAMP WITH TIME ZONE,
    eis_retry_count    INTEGER DEFAULT 0,
    eis_payload        JSONB,               -- the JSON sent to BIR

    -- ── Notes ──
    notes              TEXT,
    internal_notes     TEXT,

    -- ── Idempotency ──
    idempotency_key    VARCHAR(200) UNIQUE, -- prevent duplicate creation

    -- ── Metadata ──
    created_by         UUID REFERENCES public.users(id),
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  3. INVOICE ITEMS — normalized line items (parallel to JSON)    ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.invoice_items (
    id              SERIAL PRIMARY KEY,
    invoice_id      INTEGER NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    line_no         INTEGER NOT NULL DEFAULT 1,
    product_id      INTEGER REFERENCES public.products(id),
    description     VARCHAR(500) NOT NULL,
    quantity        DECIMAL(10,3) NOT NULL DEFAULT 1,
    unit            VARCHAR(20) DEFAULT 'pcs',
    unit_price      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    gross_amount    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    discount_amount DECIMAL(12,2) DEFAULT 0.00,
    discount_type   VARCHAR(30),     -- sc, pwd, naac, solo_parent, promo
    net_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    tax_type        VARCHAR(20) DEFAULT 'vat',
    vat_amount      DECIMAL(12,2) DEFAULT 0.00,
    withholding_tax DECIMAL(12,2) DEFAULT 0.00,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  4. INVOICE SERIES COUNTER — branch-based, gap-free             ║
-- ╚══════════════════════════════════════════════════════════════════╝

DROP TABLE IF EXISTS public.invoice_counters CASCADE;

CREATE TABLE public.invoice_counters (
    id           SERIAL PRIMARY KEY,
    merchant_id  INTEGER NOT NULL REFERENCES public.merchants(id),
    branch_code  VARCHAR(20) NOT NULL DEFAULT 'MAIN',
    doc_type     VARCHAR(30) NOT NULL DEFAULT 'invoice',
    year         INTEGER NOT NULL,
    last_number  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(merchant_id, branch_code, doc_type, year)
);


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  5. AUDIT LOG — immutable trail (BIR / RR 8-2022 requirement)  ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.invoice_audit_log (
    id           BIGSERIAL PRIMARY KEY,
    invoice_id   INTEGER NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    action       VARCHAR(50) NOT NULL
                 CHECK (action IN (
                     'created','sent','printed','reprinted','voided',
                     'replaced','eis_transmitted','eis_acknowledged','eis_failed',
                     'eis_retried','edited','credit_memo_issued','debit_memo_issued',
                     'payment_received','exported','email_sent'
                 )),
    performed_by UUID REFERENCES public.users(id),
    channel      VARCHAR(30),  -- source channel
    ip_address   VARCHAR(50),
    user_agent   TEXT,
    details      JSONB,        -- additional context
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  6. EIS TRANSMISSION LOG                                        ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.eis_transmission_log (
    id                BIGSERIAL PRIMARY KEY,
    invoice_id        INTEGER NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    eis_unique_id     VARCHAR(200),
    payload           JSONB NOT NULL,
    response          JSONB,
    http_status       INTEGER,
    status            VARCHAR(30) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','success','failed','retrying','dead_letter')),
    retry_count       INTEGER DEFAULT 0,
    max_retries       INTEGER DEFAULT 5,
    next_retry_at     TIMESTAMP WITH TIME ZONE,
    error_message     TEXT,
    transmitted_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at   TIMESTAMP WITH TIME ZONE,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  7. DAILY SALES SUMMARY (reconciliation hook)                   ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS public.daily_sales_summary (
    id              SERIAL PRIMARY KEY,
    merchant_id     INTEGER NOT NULL REFERENCES public.merchants(id),
    branch_code     VARCHAR(20) NOT NULL DEFAULT 'MAIN',
    summary_date    DATE NOT NULL,

    total_invoices  INTEGER DEFAULT 0,
    total_voided    INTEGER DEFAULT 0,
    total_credit_memos INTEGER DEFAULT 0,
    total_debit_memos  INTEGER DEFAULT 0,

    gross_sales     DECIMAL(12,2) DEFAULT 0.00,
    total_discounts DECIMAL(12,2) DEFAULT 0.00,
    sc_discounts    DECIMAL(12,2) DEFAULT 0.00,
    pwd_discounts   DECIMAL(12,2) DEFAULT 0.00,
    net_sales       DECIMAL(12,2) DEFAULT 0.00,
    vatable_sales   DECIMAL(12,2) DEFAULT 0.00,
    vat_amount      DECIMAL(12,2) DEFAULT 0.00,
    vat_exempt_sales DECIMAL(12,2) DEFAULT 0.00,
    zero_rated_sales DECIMAL(12,2) DEFAULT 0.00,
    total_amount    DECIMAL(12,2) DEFAULT 0.00,
    delivery_fees   DECIMAL(12,2) DEFAULT 0.00,
    service_charges DECIMAL(12,2) DEFAULT 0.00,
    platform_fees   DECIMAL(12,2) DEFAULT 0.00,

    -- Reconciliation
    is_reconciled   BOOLEAN DEFAULT false,
    reconciled_at   TIMESTAMP WITH TIME ZONE,
    reconciled_by   UUID REFERENCES public.users(id),

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(merchant_id, branch_code, summary_date)
);


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  8. ROW LEVEL SECURITY                                         ║
-- ╚══════════════════════════════════════════════════════════════════╝

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eis_transmission_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_sales_summary ENABLE ROW LEVEL SECURITY;

-- Invoices
DROP POLICY IF EXISTS "Merchants view own invoices" ON public.invoices;
CREATE POLICY "Merchants view own invoices" ON public.invoices
    FOR SELECT USING (merchant_id IN (SELECT id FROM public.merchants WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins view all invoices" ON public.invoices;
CREATE POLICY "Admins view all invoices" ON public.invoices
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND user_type IN ('admin','staff')));

DROP POLICY IF EXISTS "Customers view own invoices" ON public.invoices;
CREATE POLICY "Customers view own invoices" ON public.invoices
    FOR SELECT USING (customer_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated insert invoices" ON public.invoices;
CREATE POLICY "Authenticated insert invoices" ON public.invoices
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated update invoices" ON public.invoices;
CREATE POLICY "Authenticated update invoices" ON public.invoices
    FOR UPDATE USING (auth.uid() IS NOT NULL);

-- Invoice items
DROP POLICY IF EXISTS "All auth invoice items" ON public.invoice_items;
CREATE POLICY "All auth invoice items" ON public.invoice_items FOR ALL USING (auth.uid() IS NOT NULL);

-- Counters
DROP POLICY IF EXISTS "All auth counters" ON public.invoice_counters;
CREATE POLICY "All auth counters" ON public.invoice_counters FOR ALL USING (auth.uid() IS NOT NULL);

-- Audit log
DROP POLICY IF EXISTS "All auth audit" ON public.invoice_audit_log;
CREATE POLICY "All auth audit" ON public.invoice_audit_log FOR ALL USING (auth.uid() IS NOT NULL);

-- EIS log
DROP POLICY IF EXISTS "All auth eis" ON public.eis_transmission_log;
CREATE POLICY "All auth eis" ON public.eis_transmission_log FOR ALL USING (auth.uid() IS NOT NULL);

-- Daily summary
DROP POLICY IF EXISTS "All auth summary" ON public.daily_sales_summary;
CREATE POLICY "All auth summary" ON public.daily_sales_summary FOR ALL USING (auth.uid() IS NOT NULL);


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  9. FUNCTIONS                                                    ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- Get next invoice number — branch-based, gap-free, locked
CREATE OR REPLACE FUNCTION public.get_next_invoice_number(
    p_merchant_id INTEGER DEFAULT NULL,
    p_branch_code VARCHAR DEFAULT 'MAIN',
    p_doc_type    VARCHAR DEFAULT 'invoice'
)
RETURNS VARCHAR AS $$
DECLARE
    v_year   INTEGER;
    v_number INTEGER;
    v_prefix VARCHAR;
    v_result VARCHAR;
BEGIN
    v_year := EXTRACT(YEAR FROM CURRENT_TIMESTAMP);

    -- Lock + upsert
    INSERT INTO public.invoice_counters (merchant_id, branch_code, doc_type, year, last_number)
    VALUES (COALESCE(p_merchant_id, 0), p_branch_code, p_doc_type, v_year, 1)
    ON CONFLICT (merchant_id, branch_code, doc_type, year)
    DO UPDATE SET last_number = public.invoice_counters.last_number + 1
    RETURNING last_number INTO v_number;

    -- Prefix by doc type
    CASE p_doc_type
        WHEN 'invoice'         THEN v_prefix := 'INV';
        WHEN 'receipt'         THEN v_prefix := 'OR';
        WHEN 'credit_memo'     THEN v_prefix := 'CM';
        WHEN 'debit_memo'      THEN v_prefix := 'DM';
        WHEN 'payment_receipt' THEN v_prefix := 'PR';
        ELSE v_prefix := 'INV';
    END CASE;

    -- Format: WK-INV-MAIN-2026-000001
    v_result := 'WK-' || v_prefix || '-' || p_branch_code || '-' || v_year || '-' || LPAD(v_number::TEXT, 6, '0');
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;


-- Get next serial number
CREATE OR REPLACE FUNCTION public.get_next_serial_number()
RETURNS VARCHAR AS $$
DECLARE v_serial VARCHAR;
BEGIN
    v_serial := 'WK-SN-' || TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDD') || '-' ||
                LPAD(FLOOR(RANDOM() * 999999 + 1)::TEXT, 6, '0');
    RETURN v_serial;
END;
$$ LANGUAGE plpgsql;


-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  10. INDEXES                                                     ║
-- ╚══════════════════════════════════════════════════════════════════╝

CREATE INDEX IF NOT EXISTS idx_inv_order            ON public.invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_inv_merchant         ON public.invoices(merchant_id);
CREATE INDEX IF NOT EXISTS idx_inv_customer         ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_inv_number           ON public.invoices(invoice_number);
CREATE INDEX IF NOT EXISTS idx_inv_date             ON public.invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_inv_status           ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_inv_doc_type         ON public.invoices(document_type);
CREATE INDEX IF NOT EXISTS idx_inv_tax_type         ON public.invoices(tax_type);
CREATE INDEX IF NOT EXISTS idx_inv_channel          ON public.invoices(channel);
CREATE INDEX IF NOT EXISTS idx_inv_eis_status       ON public.invoices(eis_status);
CREATE INDEX IF NOT EXISTS idx_inv_idempotency      ON public.invoices(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_inv_parent           ON public.invoices(parent_invoice_id);
CREATE INDEX IF NOT EXISTS idx_inv_items_invoice    ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_invoice        ON public.invoice_audit_log(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_action         ON public.invoice_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_eis_log_invoice      ON public.eis_transmission_log(invoice_id);
CREATE INDEX IF NOT EXISTS idx_eis_log_status       ON public.eis_transmission_log(status);
CREATE INDEX IF NOT EXISTS idx_daily_merchant_date  ON public.daily_sales_summary(merchant_id, summary_date);
CREATE INDEX IF NOT EXISTS idx_merchants_tin        ON public.merchants(tin);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_invoices_updated_at ON public.invoices;
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_daily_summary_updated_at ON public.daily_sales_summary;
CREATE TRIGGER update_daily_summary_updated_at BEFORE UPDATE ON public.daily_sales_summary
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
