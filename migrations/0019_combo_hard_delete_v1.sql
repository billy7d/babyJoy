-- Combo được coi là Product bán được; Product delete vẫn là DELETE vật lý.
PRAGMA foreign_keys = ON;

ALTER TABLE products
  ADD COLUMN product_type TEXT NOT NULL DEFAULT 'STANDARD'
    CHECK (product_type IN ('STANDARD', 'COMBO'));

ALTER TABLE products
  ADD COLUMN base_price_vnd INTEGER
    CHECK (base_price_vnd IS NULL OR base_price_vnd >= 0);

CREATE TABLE combo_configs (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  group_mode TEXT NOT NULL CHECK (group_mode IN ('ALL_GROUPS', 'ONE_OF_GROUPS')),
  config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE combo_groups (
  id TEXT PRIMARY KEY,
  combo_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  selection_type TEXT NOT NULL CHECK (
    selection_type IN ('FIXED', 'CHOOSE', 'CHOOSE_QUANTITY')
  ),
  min_select INTEGER NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select INTEGER NOT NULL DEFAULT 0 CHECK (max_select >= min_select),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE combo_group_items (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES combo_groups(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  fixed_quantity INTEGER NOT NULL DEFAULT 0 CHECK (fixed_quantity >= 0),
  min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (min_quantity >= 0),
  max_quantity INTEGER NOT NULL DEFAULT 1 CHECK (max_quantity >= min_quantity),
  price_adjustment INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (group_id, variant_id)
);

CREATE INDEX idx_combo_groups_product_order
  ON combo_groups(combo_product_id, display_order, id);
CREATE INDEX idx_combo_group_items_group_order
  ON combo_group_items(group_id, display_order, id);
CREATE INDEX idx_combo_group_items_variant
  ON combo_group_items(variant_id, group_id);

ALTER TABLE cart_request_items
  ADD COLUMN line_type TEXT NOT NULL DEFAULT 'STANDARD'
    CHECK (line_type IN ('STANDARD', 'COMBO'));
ALTER TABLE cart_request_items ADD COLUMN combo_product_id TEXT;
ALTER TABLE cart_request_items
  ADD COLUMN combo_version INTEGER CHECK (combo_version IS NULL OR combo_version >= 1);
ALTER TABLE cart_request_items ADD COLUMN combo_selection_json TEXT;

CREATE TABLE cart_request_combo_components (
  id TEXT PRIMARY KEY,
  cart_request_item_id TEXT NOT NULL REFERENCES cart_request_items(id) ON DELETE CASCADE,
  combo_product_id TEXT NOT NULL,
  combo_version INTEGER NOT NULL CHECK (combo_version >= 1),
  group_id TEXT,
  group_name_snapshot TEXT NOT NULL,
  group_item_id TEXT,
  variant_id TEXT,
  product_id TEXT,
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT,
  image_key_snapshot TEXT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9900),
  price_adjustment_vnd INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cart_request_combo_components_item
  ON cart_request_combo_components(cart_request_item_id, created_at, id);
CREATE INDEX idx_cart_request_combo_components_variant
  ON cart_request_combo_components(variant_id, created_at, id);

-- Lịch sử giữ snapshot riêng; các FK product/variant trong cart cũ vốn đã nullable
-- nên hard-delete Product không làm mất tên, SKU hay giá đã gửi cho khách.
