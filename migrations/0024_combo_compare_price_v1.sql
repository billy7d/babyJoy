PRAGMA foreign_keys = ON;

-- Giá so sánh của Combo là metadata hiển thị; giá bán thực tế vẫn do
-- products.base_price_vnd + price_adjustment quyết định ở phía server.
ALTER TABLE combo_configs
  ADD COLUMN compare_at_price_vnd INTEGER
    CHECK (compare_at_price_vnd IS NULL OR compare_at_price_vnd >= 0);
