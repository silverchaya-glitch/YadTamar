-- יד תמר — סכימת PostgreSQL לפי CLAUDE/erd.md (11 ישויות)
-- הרצה: psql -d yadtamar -f server/db/schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- מספרי הזמנה רציפים בסגנון YT-0001 (עצמאי מה-UUID PK)
CREATE SEQUENCE IF NOT EXISTS order_number_seq;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Customer ----------------------------------------------------------
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. Category ------------------------------------------------------------
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Story ----------------------------------------------------------------
CREATE TABLE stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_code TEXT NOT NULL UNIQUE,                 -- DC-02
  category_id UUID NOT NULL REFERENCES categories(id),
  title TEXT NOT NULL,
  google_drive_file_id TEXT NOT NULL,               -- DC-04
  duration_seconds INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_stories_updated_at BEFORE UPDATE ON stories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. PricingRule ------------------------------------------------------
CREATE TABLE pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minimum_quantity INTEGER NOT NULL,
  maximum_quantity INTEGER,                          -- NULL = ללא הגבלה עליונה
  unit_price NUMERIC(10,2) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Order ------------------------------------------------------------------
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,                 -- DC-01
  customer_id UUID NOT NULL REFERENCES customers(id),
  order_type TEXT NOT NULL CHECK (order_type IN ('STORY_SELECTION','FULL_LIBRARY','ADULT_COLLECTION')),
  delivery_type TEXT NOT NULL CHECK (delivery_type IN ('SELECTED_STORIES','MASTER_LIBRARY','ADULT_COLLECTION','GIFT_STORY')),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('CREDIT_CARD','BANK_TRANSFER','CALLBACK')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('PENDING','PAID','FAILED','CANCELLED')) DEFAULT 'PENDING',
  processing_status TEXT NOT NULL CHECK (processing_status IN ('CREATED','WAITING_PAYMENT','READY_FOR_FULFILLMENT','PROCESSING','COMPLETED','FAILED')) DEFAULT 'CREATED',
  subtotal_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  usb_amount NUMERIC(10,2),                          -- NULL = לא נבחר USB; 0 = USB חינם; >0 = USB בתשלום
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount >= 0),  -- DC-05
  folder_url TEXT,
  office_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DC-06: הזמנה ששולמה (PAID) לא יכולה לחזור ל-PENDING
CREATE OR REPLACE FUNCTION prevent_paid_to_pending()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.payment_status = 'PAID' AND NEW.payment_status = 'PENDING' THEN
    RAISE EXCEPTION 'לא ניתן להחזיר הזמנה ששולמה (PAID) לסטטוס PENDING — order_id=%', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_orders_no_paid_to_pending BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION prevent_paid_to_pending();

-- 7. OrderItem -------------------------------------------------------------
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  story_id UUID REFERENCES stories(id),
  story_code_snapshot TEXT NOT NULL,                 -- DC-09
  story_title_snapshot TEXT NOT NULL,                -- DC-09
  unit_price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Payment ------------------------------------------------------------
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL DEFAULT 'HYP' CHECK (provider IN ('HYP')),
  provider_transaction_id TEXT,
  amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','FAILED')) DEFAULT 'PENDING',
  raw_response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_payments_provider_transaction_id
  ON payments (provider_transaction_id) WHERE provider_transaction_id IS NOT NULL; -- DC-07

-- 9. FulfillmentRequest -----------------------------------------------
CREATE TABLE fulfillment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id),  -- DC-08
  request_status TEXT NOT NULL CHECK (request_status IN ('PENDING','SENT','COMPLETED','FAILED')) DEFAULT 'PENDING',
  attempts_count INTEGER NOT NULL DEFAULT 0,
  shared_email TEXT,
  shared_at TIMESTAMPTZ,
  sharing_status TEXT NOT NULL CHECK (sharing_status IN ('PENDING','SHARED','FAILED','WAITING_MANUAL')) DEFAULT 'PENDING',
  external_folder_id TEXT,
  external_folder_url TEXT,
  error_code TEXT,
  error_message TEXT,
  item_results JSONB,
  request_sent_at TIMESTAMPTZ,
  response_received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_fulfillment_requests_updated_at BEFORE UPDATE ON fulfillment_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 10. EmailLog -------------------------------------------------------------
CREATE TABLE email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  customer_id UUID REFERENCES customers(id),
  email_type TEXT NOT NULL CHECK (email_type IN ('PURCHASE_CONFIRMATION','FILE_DELIVERY','GIFT_STORY','OFFICE_NOTIFICATION','ERROR_NOTIFICATION')),
  recipient_email TEXT NOT NULL,
  send_status TEXT NOT NULL CHECK (send_status IN ('PENDING','SENT','FAILED')) DEFAULT 'PENDING',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. Lead --------------------------------------------------------------
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  source TEXT,
  gift_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. AdminUser -----------------------------------------------------------
CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- אינדקסים שימושיים לשאילתות אדמין/חנות
CREATE INDEX idx_stories_category ON stories(category_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_story ON order_items(story_id);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_email_logs_order ON email_logs(order_id);
CREATE INDEX idx_email_logs_customer ON email_logs(customer_id);
