-- Ràng buộc reservation với access session opaque và khóa quota ngay trong D1.
PRAGMA foreign_keys = ON;

ALTER TABLE cart_requests ADD COLUMN storefront_session_id TEXT;

CREATE INDEX idx_cart_requests_storefront_session_reservation
  ON cart_requests(storefront_session_id, checkout_state, reservation_expires_at);

INSERT INTO app_settings (key, value, updated_at)
VALUES
  ('storefront_max_active_reservations_per_session', '2', CURRENT_TIMESTAMP),
  ('storefront_max_total_reserved_units_per_session', '100', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;

-- Không cho phép đổi danh tính server-side sau khi request đã được gắn session.
CREATE TRIGGER cart_requests_guard_storefront_session_binding
BEFORE UPDATE OF storefront_session_id ON cart_requests
WHEN OLD.storefront_session_id IS NOT NULL
  AND NEW.storefront_session_id IS NOT OLD.storefront_session_id
BEGIN
  SELECT RAISE(ABORT, 'SUBMISSION_SESSION_MISMATCH');
END;

-- D1 là lớp quyết định cuối cùng cho giới hạn số reservation đang hoạt động.
CREATE TRIGGER cart_requests_guard_storefront_active_limit
BEFORE UPDATE OF checkout_state ON cart_requests
WHEN NEW.checkout_state = 'WAITING_SELLER_CONFIRM'
  AND OLD.checkout_state != NEW.checkout_state
  AND NEW.storefront_session_id IS NOT NULL
BEGIN
  SELECT (CASE WHEN (
    SELECT COUNT(*)
    FROM cart_requests existing_request
    WHERE existing_request.storefront_session_id = NEW.storefront_session_id
      AND existing_request.id != NEW.id
      AND existing_request.checkout_state = 'WAITING_SELLER_CONFIRM'
      AND julianday(existing_request.reservation_expires_at) > julianday('now')
  ) >= COALESCE(
    (
      SELECT CAST(value AS INTEGER)
      FROM app_settings
      WHERE key = 'storefront_max_active_reservations_per_session'
        AND CAST(value AS INTEGER) BETWEEN 1 AND 10
    ),
    2
  ) THEN RAISE(ABORT, 'ACTIVE_RESERVATION_LIMIT') END);
END;

-- Mỗi INSERT reservation đều kiểm tra tổng đơn vị đang giữ để chống race giữa các request.
CREATE TRIGGER inventory_reservations_guard_storefront_units
BEFORE INSERT ON inventory_reservations
WHEN NEW.status = 'ACTIVE'
  AND (
    SELECT storefront_session_id
    FROM cart_requests
    WHERE id = NEW.cart_request_id
  ) IS NOT NULL
BEGIN
  SELECT (CASE WHEN (
    COALESCE(
      (
        SELECT SUM(existing_reservation.quantity)
        FROM inventory_reservations existing_reservation
        JOIN cart_requests existing_request
          ON existing_request.id = existing_reservation.cart_request_id
        WHERE existing_reservation.status = 'ACTIVE'
          AND julianday(existing_reservation.expires_at) > julianday('now')
          AND existing_request.storefront_session_id = (
            SELECT storefront_session_id
            FROM cart_requests
            WHERE id = NEW.cart_request_id
          )
      ),
      0
    ) + NEW.quantity
  ) > COALESCE(
    (
      SELECT CAST(value AS INTEGER)
      FROM app_settings
      WHERE key = 'storefront_max_total_reserved_units_per_session'
        AND CAST(value AS INTEGER) BETWEEN 1 AND 9999
    ),
    100
  ) THEN RAISE(ABORT, 'RESERVED_UNITS_LIMIT') END);
END;
