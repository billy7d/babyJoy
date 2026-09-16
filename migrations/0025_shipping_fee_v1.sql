-- Snapshot phí vận chuyển theo từng cart request; giỏ lịch sử mặc định 0đ.
PRAGMA foreign_keys = ON;

ALTER TABLE cart_requests
ADD COLUMN shipping_fee_vnd INTEGER NOT NULL DEFAULT 0
CHECK (shipping_fee_vnd >= 0);
