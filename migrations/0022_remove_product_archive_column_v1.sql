-- Chuyển Product từng archive sang HIDDEN trước khi bỏ cột archive để không làm lộ dữ liệu cũ.
UPDATE products
SET status = 'HIDDEN', updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
WHERE archived_at IS NOT NULL AND status != 'HIDDEN';

-- Product chỉ còn visibility status; loại bỏ cột archive không còn được sử dụng.
ALTER TABLE products DROP COLUMN archived_at;
