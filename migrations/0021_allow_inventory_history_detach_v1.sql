-- Cho phép FK vận hành tự tách về NULL khi Variant bị hard-delete; snapshot vẫn bất biến.
DROP TRIGGER IF EXISTS inventory_reservations_immutable_fields;

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
