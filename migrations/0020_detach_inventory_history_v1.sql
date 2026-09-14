-- Tách FK vận hành khỏi lịch sử tồn kho để Product/Variant có thể hard-delete.
PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS inventory_reservations_validate_insert;
DROP TRIGGER IF EXISTS inventory_reservations_apply_insert;
DROP TRIGGER IF EXISTS inventory_reservations_immutable_fields;
DROP TRIGGER IF EXISTS inventory_reservations_guard_status;
DROP TRIGGER IF EXISTS inventory_reservations_validate_release;
DROP TRIGGER IF EXISTS inventory_reservations_apply_release;
DROP TRIGGER IF EXISTS inventory_reservations_apply_consume;
DROP TRIGGER IF EXISTS inventory_reservations_guard_variant_update;
DROP TRIGGER IF EXISTS inventory_reservations_guard_variant_delete;

ALTER TABLE inventory_reservations RENAME TO inventory_reservations_legacy_v1;
ALTER TABLE inventory_movements RENAME TO inventory_movements_legacy_v1;

CREATE TABLE inventory_reservations (
  id TEXT PRIMARY KEY,
  cart_request_id TEXT NOT NULL REFERENCES cart_requests(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  variant_name_snapshot TEXT NOT NULL DEFAULT '',
  sku_snapshot TEXT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  source_type TEXT NOT NULL CHECK (source_type IN ('CART_ITEM', 'PROMOTION_GIFT')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  released_at TEXT,
  release_reason TEXT
);

INSERT INTO inventory_reservations (
  id, cart_request_id, variant_id, variant_name_snapshot, sku_snapshot,
  quantity, source_type, status, expires_at, created_at, consumed_at,
  released_at, release_reason
)
SELECT r.id, r.cart_request_id, r.variant_id, COALESCE(v.name, ''), v.sku,
  r.quantity, r.source_type, r.status, r.expires_at, r.created_at,
  r.consumed_at, r.released_at, r.release_reason
FROM inventory_reservations_legacy_v1 r
LEFT JOIN product_variants v ON v.id = r.variant_id;

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  variant_name_snapshot TEXT NOT NULL DEFAULT '',
  sku_snapshot TEXT,
  cart_request_id TEXT REFERENCES cart_requests(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL CHECK (
    movement_type IN ('INITIAL_STOCK', 'RESTOCK', 'MANUAL_ADJUSTMENT', 'ORDER_CONFIRMED')
  ),
  quantity_delta INTEGER NOT NULL,
  stock_before INTEGER NOT NULL CHECK (stock_before >= 0),
  stock_after INTEGER NOT NULL CHECK (stock_after >= 0),
  note TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO inventory_movements (
  id, variant_id, variant_name_snapshot, sku_snapshot, cart_request_id,
  movement_type, quantity_delta, stock_before, stock_after, note, created_at
)
SELECT m.id, m.variant_id, COALESCE(v.name, ''), v.sku, m.cart_request_id,
  m.movement_type, m.quantity_delta, m.stock_before, m.stock_after,
  m.note, m.created_at
FROM inventory_movements_legacy_v1 m
LEFT JOIN product_variants v ON v.id = m.variant_id;

DROP TABLE inventory_reservations_legacy_v1;
DROP TABLE inventory_movements_legacy_v1;

CREATE INDEX idx_inventory_reservations_active_expiry
  ON inventory_reservations(status, expires_at);
CREATE INDEX idx_inventory_reservations_request
  ON inventory_reservations(cart_request_id, status);
CREATE INDEX idx_inventory_reservations_variant
  ON inventory_reservations(variant_id, status);
CREATE UNIQUE INDEX idx_inventory_reservations_active_unique
  ON inventory_reservations(cart_request_id, variant_id, source_type)
  WHERE status = 'ACTIVE' AND variant_id IS NOT NULL;
CREATE INDEX idx_inventory_movements_variant_time
  ON inventory_movements(variant_id, created_at, id);
CREATE INDEX idx_inventory_movements_request
  ON inventory_movements(cart_request_id, created_at);

-- Chỉ reservation ACTIVE mới được trừ available stock; Product archive không còn là điều kiện bán.
CREATE TRIGGER inventory_reservations_validate_insert
BEFORE INSERT ON inventory_reservations
WHEN NEW.status = 'ACTIVE'
BEGIN
  SELECT (CASE WHEN NEW.variant_id IS NULL THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE id = NEW.variant_id AND track_inventory = 1
  ) THEN RAISE(ABORT, 'INVENTORY_NOT_TRACKED') END);
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.id = NEW.variant_id
      AND v.availability = 'AVAILABLE'
      AND p.status = 'AVAILABLE'
  ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END);
END;

CREATE TRIGGER inventory_reservations_apply_insert
AFTER INSERT ON inventory_reservations
WHEN NEW.status = 'ACTIVE'
BEGIN
  UPDATE product_variants
  SET reserved_quantity = reserved_quantity + NEW.quantity
  WHERE id = NEW.variant_id
    AND track_inventory = 1
    AND stock_on_hand - reserved_quantity >= NEW.quantity;
  SELECT (CASE WHEN changes() != 1 THEN RAISE(ABORT, 'INSUFFICIENT_STOCK') END);
END;

CREATE TRIGGER inventory_reservations_immutable_fields
BEFORE UPDATE OF cart_request_id, variant_id, quantity, source_type, expires_at, created_at ON inventory_reservations
WHEN NOT (NEW.variant_id IS NULL AND OLD.status != 'ACTIVE')
  AND (NEW.cart_request_id IS NOT OLD.cart_request_id
  OR NEW.variant_id IS NOT OLD.variant_id
  OR NEW.quantity IS NOT OLD.quantity
  OR NEW.source_type IS NOT OLD.source_type
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at)
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_RESERVATION_IMMUTABLE');
END;

CREATE TRIGGER inventory_reservations_guard_status
BEFORE UPDATE OF status ON inventory_reservations
WHEN (OLD.status != 'ACTIVE' AND NEW.status != OLD.status)
  OR (OLD.status = 'ACTIVE' AND NEW.status NOT IN ('RELEASED', 'CONSUMED'))
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_RESERVATION_INVALID_STATUS');
END;

CREATE TRIGGER inventory_reservations_validate_release
BEFORE UPDATE OF status ON inventory_reservations
WHEN OLD.status = 'ACTIVE' AND NEW.status IN ('RELEASED', 'CONSUMED')
BEGIN
  SELECT (CASE WHEN OLD.variant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE id = OLD.variant_id AND reserved_quantity >= OLD.quantity
  ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END);
  SELECT (CASE WHEN NEW.status = 'CONSUMED' AND NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE id = OLD.variant_id AND stock_on_hand >= OLD.quantity
  ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END);
END;

CREATE TRIGGER inventory_reservations_apply_release
AFTER UPDATE OF status ON inventory_reservations
WHEN OLD.status = 'ACTIVE' AND NEW.status = 'RELEASED'
BEGIN
  UPDATE product_variants
  SET reserved_quantity = reserved_quantity - OLD.quantity
  WHERE id = OLD.variant_id;
END;

CREATE TRIGGER inventory_reservations_apply_consume
AFTER UPDATE OF status ON inventory_reservations
WHEN OLD.status = 'ACTIVE' AND NEW.status = 'CONSUMED'
BEGIN
  INSERT INTO inventory_movements (
    id, variant_id, variant_name_snapshot, sku_snapshot, cart_request_id,
    movement_type, quantity_delta, stock_before, stock_after, note, created_at
  )
  SELECT lower(hex(randomblob(16))), OLD.variant_id, COALESCE(v.name, OLD.variant_name_snapshot),
    COALESCE(v.sku, OLD.sku_snapshot), OLD.cart_request_id,
    'ORDER_CONFIRMED', -OLD.quantity, v.stock_on_hand,
    v.stock_on_hand - OLD.quantity, 'Đơn hàng được người bán xác nhận.',
    COALESCE(NEW.consumed_at, CURRENT_TIMESTAMP)
  FROM product_variants v WHERE v.id = OLD.variant_id;
  UPDATE product_variants
  SET reserved_quantity = reserved_quantity - OLD.quantity,
      stock_on_hand = stock_on_hand - OLD.quantity
  WHERE id = OLD.variant_id;
END;

CREATE TRIGGER inventory_reservations_guard_variant_update
BEFORE UPDATE OF track_inventory, stock_on_hand ON product_variants
BEGIN
  SELECT (CASE WHEN NEW.stock_on_hand < NEW.reserved_quantity
    THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END);
  SELECT (CASE WHEN OLD.track_inventory = 1
    AND NEW.track_inventory = 0
    AND EXISTS (
      SELECT 1 FROM inventory_reservations
      WHERE variant_id = OLD.id AND status = 'ACTIVE'
    ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END);
END;

CREATE TRIGGER inventory_reservations_guard_variant_delete
BEFORE DELETE ON product_variants
WHEN EXISTS (
  SELECT 1 FROM inventory_reservations
  WHERE variant_id = OLD.id AND status = 'ACTIVE'
)
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_CONFLICT');
END;

PRAGMA foreign_keys = ON;
