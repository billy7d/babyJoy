-- Cập nhật riêng tên hiển thị storefront, không thay đổi các cài đặt seller khác.
INSERT INTO app_settings (key, value, updated_at)
VALUES ('seller_display_name', 'Đồ ăn dặm UK 🍼Trà Phương🍼', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at
WHERE app_settings.value = 'BabyJoy' OR TRIM(app_settings.value) = '';
