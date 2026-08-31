-- Promotion Management P0 + P1: cấu hình JSON đã được validate ở server và snapshot bất biến.
PRAGMA foreign_keys = ON;

ALTER TABLE cart_requests ADD COLUMN promotion_discount_vnd INTEGER NOT NULL DEFAULT 0 CHECK (promotion_discount_vnd >= 0);
ALTER TABLE cart_requests ADD COLUMN final_total_vnd INTEGER NOT NULL DEFAULT 0 CHECK (final_total_vnd >= 0);
UPDATE cart_requests
SET final_total_vnd = CASE
  WHEN subtotal_vnd - promotion_discount_vnd < 0 THEN 0
  ELSE subtotal_vnd - promotion_discount_vnd
END
WHERE final_total_vnd = 0;

CREATE TABLE promotions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN (
    'ORDER_FIXED_DISCOUNT',
    'ORDER_PERCENTAGE_DISCOUNT',
    'ORDER_GIFT',
    'BUY_X_GET_Y',
    'PRODUCT_DISCOUNT',
    'CATEGORY_DISCOUNT',
    'QUANTITY_DISCOUNT',
    'COMBO_DISCOUNT',
    'TIERED_DISCOUNT'
  )),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED')),
  priority INTEGER NOT NULL DEFAULT 0,
  stackable INTEGER NOT NULL DEFAULT 0 CHECK (stackable IN (0, 1)),
  starts_at TEXT,
  ends_at TEXT,
  usage_limit_total INTEGER CHECK (usage_limit_total IS NULL OR usage_limit_total >= 1),
  usage_limit_per_customer INTEGER CHECK (usage_limit_per_customer IS NULL OR usage_limit_per_customer >= 1),
  usage_count_total INTEGER NOT NULL DEFAULT 0 CHECK (usage_count_total >= 0),
  config_json TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_promotions_status_schedule
  ON promotions(status, starts_at, ends_at, priority DESC);
CREATE INDEX idx_promotions_type_status
  ON promotions(type, status);

-- Trigger giúp batch ghi cart + redemption vẫn fail-closed khi hai request chạy đồng thời.
CREATE TRIGGER promotions_usage_limit_guard
BEFORE UPDATE OF usage_count_total ON promotions
WHEN NEW.usage_limit_total IS NOT NULL
  AND NEW.usage_count_total > NEW.usage_limit_total
BEGIN
  SELECT RAISE(ABORT, 'PROMOTION_USAGE_LIMIT');
END;

CREATE TABLE cart_request_promotions (
  id TEXT PRIMARY KEY,
  cart_request_id TEXT NOT NULL REFERENCES cart_requests(id) ON DELETE CASCADE,
  promotion_id TEXT,
  promotion_name_snapshot TEXT NOT NULL,
  promotion_type_snapshot TEXT NOT NULL,
  discount_amount_vnd INTEGER NOT NULL CHECK (discount_amount_vnd >= 0),
  config_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_cart_request_promotions_request
  ON cart_request_promotions(cart_request_id, created_at, id);
CREATE INDEX idx_cart_request_promotions_promotion
  ON cart_request_promotions(promotion_id, created_at);

CREATE TABLE cart_request_promotion_gifts (
  id TEXT PRIMARY KEY,
  cart_request_id TEXT NOT NULL REFERENCES cart_requests(id) ON DELETE CASCADE,
  promotion_id TEXT,
  product_id TEXT,
  variant_id TEXT,
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT,
  image_key_snapshot TEXT,
  unit_price_vnd INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_vnd = 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total_vnd INTEGER NOT NULL DEFAULT 0 CHECK (line_total_vnd = 0),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_cart_request_promotion_gifts_request
  ON cart_request_promotion_gifts(cart_request_id, created_at, id);

CREATE TABLE promotion_redemptions (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL,
  cart_request_id TEXT NOT NULL REFERENCES cart_requests(id) ON DELETE CASCADE,
  customer_key TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(promotion_id, cart_request_id)
);

CREATE INDEX idx_promotion_redemptions_promotion
  ON promotion_redemptions(promotion_id, created_at);
CREATE INDEX idx_promotion_redemptions_customer
  ON promotion_redemptions(promotion_id, customer_key, created_at);
