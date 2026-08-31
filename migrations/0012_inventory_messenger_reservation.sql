-- Inventory reservation và trạng thái checkout mới được mở rộng, không phá lịch sử cũ.
PRAGMA foreign_keys = ON;

ALTER TABLE product_variants ADD COLUMN track_inventory INTEGER NOT NULL DEFAULT 0 CHECK (track_inventory IN (0, 1));
ALTER TABLE product_variants ADD COLUMN stock_on_hand INTEGER NOT NULL DEFAULT 0 CHECK (stock_on_hand >= 0);
ALTER TABLE product_variants ADD COLUMN reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0);

ALTER TABLE cart_requests ADD COLUMN checkout_state TEXT NOT NULL DEFAULT 'LEGACY' CHECK (
  checkout_state IN (
    'LEGACY',
    'READY_TO_SEND',
    'WAITING_SELLER_CONFIRM',
    'CONFIRMED',
    'EXPIRED',
    'CANCELLED'
  )
);
ALTER TABLE cart_requests ADD COLUMN reservation_started_at TEXT;
ALTER TABLE cart_requests ADD COLUMN reservation_expires_at TEXT;
ALTER TABLE cart_requests ADD COLUMN reservation_duration_minutes INTEGER CHECK (
  reservation_duration_minutes IS NULL OR reservation_duration_minutes BETWEEN 3 AND 1440
);
ALTER TABLE cart_requests ADD COLUMN seller_confirmed_at TEXT;

CREATE TABLE inventory_reservations (
  id TEXT PRIMARY KEY,
  cart_request_id TEXT NOT NULL REFERENCES cart_requests(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  source_type TEXT NOT NULL CHECK (source_type IN ('CART_ITEM', 'PROMOTION_GIFT')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  released_at TEXT,
  release_reason TEXT
);

CREATE INDEX idx_inventory_reservations_active_expiry
  ON inventory_reservations(status, expires_at);
CREATE INDEX idx_inventory_reservations_request
  ON inventory_reservations(cart_request_id, status);
CREATE INDEX idx_inventory_reservations_variant
  ON inventory_reservations(variant_id, status);
CREATE UNIQUE INDEX idx_inventory_reservations_active_unique
  ON inventory_reservations(cart_request_id, variant_id, source_type)
  WHERE status = 'ACTIVE';

CREATE TABLE promotion_reservations (
  id TEXT PRIMARY KEY,
  cart_request_id TEXT NOT NULL REFERENCES cart_requests(id) ON DELETE CASCADE,
  promotion_id TEXT NOT NULL REFERENCES promotions(id),
  customer_key TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  released_at TEXT,
  release_reason TEXT
);

CREATE INDEX idx_promotion_reservations_active_expiry
  ON promotion_reservations(status, expires_at);
CREATE INDEX idx_promotion_reservations_promotion
  ON promotion_reservations(promotion_id, status);
CREATE UNIQUE INDEX idx_promotion_reservations_active_unique
  ON promotion_reservations(promotion_id, cart_request_id)
  WHERE status = 'ACTIVE';

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id),
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

CREATE INDEX idx_inventory_movements_variant_time
  ON inventory_movements(variant_id, created_at, id);
CREATE INDEX idx_inventory_movements_request
  ON inventory_movements(cart_request_id, created_at);
CREATE INDEX idx_cart_requests_waiting_expiry
  ON cart_requests(checkout_state, reservation_expires_at);

INSERT INTO app_settings (key, value, updated_at)
VALUES ('checkout_reservation_minutes', '15', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;

-- Chỉ reservation ACTIVE mới được trừ available stock; mọi lỗi đều làm hỏng cả batch.
CREATE TRIGGER inventory_reservations_validate_insert
BEFORE INSERT ON inventory_reservations
WHEN NEW.status = 'ACTIVE'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE id = NEW.variant_id AND track_inventory = 1
  ) THEN RAISE(ABORT, 'INVENTORY_NOT_TRACKED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.id = NEW.variant_id
      AND v.availability = 'AVAILABLE'
      AND p.status = 'AVAILABLE'
      AND p.archived_at IS NULL
  ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END;
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
  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'INSUFFICIENT_STOCK') END;
END;

CREATE TRIGGER inventory_reservations_immutable_fields
BEFORE UPDATE OF cart_request_id, variant_id, quantity, source_type, expires_at, created_at ON inventory_reservations
WHEN NEW.cart_request_id != OLD.cart_request_id
  OR NEW.variant_id != OLD.variant_id
  OR NEW.quantity != OLD.quantity
  OR NEW.source_type != OLD.source_type
  OR NEW.expires_at != OLD.expires_at
  OR NEW.created_at != OLD.created_at
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
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE id = OLD.variant_id AND reserved_quantity >= OLD.quantity
  ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END;
  SELECT CASE WHEN NEW.status = 'CONSUMED' AND NOT EXISTS (
    SELECT 1 FROM product_variants
    WHERE id = OLD.variant_id AND stock_on_hand >= OLD.quantity
  ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END;
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
    id, variant_id, cart_request_id, movement_type, quantity_delta,
    stock_before, stock_after, note, created_at
  )
  SELECT lower(hex(randomblob(16))), OLD.variant_id, OLD.cart_request_id,
    'ORDER_CONFIRMED', -OLD.quantity, stock_on_hand,
    stock_on_hand - OLD.quantity, 'Đơn hàng được người bán xác nhận.',
    COALESCE(NEW.consumed_at, CURRENT_TIMESTAMP)
  FROM product_variants WHERE id = OLD.variant_id;
  UPDATE product_variants
  SET reserved_quantity = reserved_quantity - OLD.quantity,
      stock_on_hand = stock_on_hand - OLD.quantity
  WHERE id = OLD.variant_id;
END;

CREATE TRIGGER inventory_reservations_guard_variant_update
BEFORE UPDATE OF track_inventory, stock_on_hand ON product_variants
BEGIN
  SELECT CASE WHEN NEW.stock_on_hand < NEW.reserved_quantity
    THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END;
  SELECT CASE WHEN OLD.track_inventory = 1
    AND NEW.track_inventory = 0
    AND EXISTS (
      SELECT 1 FROM inventory_reservations
      WHERE variant_id = OLD.id AND status = 'ACTIVE'
    ) THEN RAISE(ABORT, 'INVENTORY_CONFLICT') END;
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

-- Promotion quota tính cả usage đã confirm và reservation ACTIVE chưa hết hạn.
CREATE TRIGGER promotion_reservations_validate_insert
BEFORE INSERT ON promotion_reservations
WHEN NEW.status = 'ACTIVE'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM promotions p
    WHERE p.id = NEW.promotion_id
      AND p.usage_limit_total IS NOT NULL
      AND p.usage_count_total + (
        SELECT COUNT(*) FROM promotion_reservations pr
        WHERE pr.promotion_id = NEW.promotion_id
          AND pr.status = 'ACTIVE'
          AND julianday(pr.expires_at) > julianday('now')
      ) >= p.usage_limit_total
  ) THEN RAISE(ABORT, 'PROMOTION_USAGE_LIMIT') END;
END;

CREATE TRIGGER promotion_reservations_immutable_fields
BEFORE UPDATE OF cart_request_id, promotion_id, expires_at, created_at ON promotion_reservations
WHEN NEW.cart_request_id != OLD.cart_request_id OR NEW.promotion_id != OLD.promotion_id
  OR NEW.expires_at != OLD.expires_at OR NEW.created_at != OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'PROMOTION_RESERVATION_IMMUTABLE');
END;

CREATE TRIGGER promotion_reservations_guard_status
BEFORE UPDATE OF status ON promotion_reservations
WHEN (OLD.status != 'ACTIVE' AND NEW.status != OLD.status)
  OR (OLD.status = 'ACTIVE' AND NEW.status NOT IN ('RELEASED', 'CONSUMED'))
BEGIN
  SELECT RAISE(ABORT, 'PROMOTION_RESERVATION_INVALID_STATUS');
END;

CREATE TRIGGER promotion_reservations_apply_consume
AFTER UPDATE OF status ON promotion_reservations
WHEN OLD.status = 'ACTIVE' AND NEW.status = 'CONSUMED'
BEGIN
  UPDATE promotions
  SET usage_count_total = usage_count_total + 1,
      updated_at = COALESCE(NEW.consumed_at, CURRENT_TIMESTAMP)
  WHERE id = OLD.promotion_id;
  INSERT OR IGNORE INTO promotion_redemptions (
    id, promotion_id, cart_request_id, customer_key, created_at
  ) VALUES (
    lower(hex(randomblob(16))), OLD.promotion_id, OLD.cart_request_id,
    NULL, COALESCE(NEW.consumed_at, CURRENT_TIMESTAMP)
  );
END;

CREATE TRIGGER cart_requests_guard_checkout_transition
BEFORE UPDATE OF checkout_state ON cart_requests
WHEN NEW.checkout_state != OLD.checkout_state
BEGIN
  SELECT CASE WHEN NEW.checkout_state = 'CONFIRMED'
    AND OLD.checkout_state != 'WAITING_SELLER_CONFIRM'
    THEN RAISE(ABORT, 'INVALID_ORDER_TRANSITION') END;
  SELECT CASE WHEN NEW.checkout_state = 'CONFIRMED'
    AND (NEW.reservation_expires_at IS NULL OR julianday(NEW.reservation_expires_at) <= julianday('now'))
    THEN RAISE(ABORT, 'ORDER_EXPIRED') END;
  SELECT CASE WHEN NEW.checkout_state = 'WAITING_SELLER_CONFIRM'
    AND (NEW.reservation_started_at IS NULL OR NEW.reservation_expires_at IS NULL
      OR NEW.reservation_duration_minutes IS NULL)
    THEN RAISE(ABORT, 'INVALID_ORDER_TRANSITION') END;
END;

CREATE TRIGGER cart_requests_guard_reservation_snapshot
BEFORE UPDATE OF reservation_started_at, reservation_expires_at, reservation_duration_minutes ON cart_requests
WHEN OLD.checkout_state = 'WAITING_SELLER_CONFIRM'
  AND (
    NEW.reservation_started_at IS NOT OLD.reservation_started_at
    OR NEW.reservation_expires_at IS NOT OLD.reservation_expires_at
    OR NEW.reservation_duration_minutes IS NOT OLD.reservation_duration_minutes
  )
BEGIN
  SELECT RAISE(ABORT, 'RESERVATION_SNAPSHOT_IMMUTABLE');
END;
