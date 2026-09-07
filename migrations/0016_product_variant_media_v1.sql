-- Mở rộng phân loại theo hướng tương thích ngược: giữ nguyên availability hiện hữu và ảnh Product chung.
ALTER TABLE product_variants ADD COLUMN package_size TEXT NOT NULL DEFAULT '';

CREATE TABLE product_variant_images (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(variant_id, r2_key)
);

CREATE INDEX idx_product_variant_images_variant_sort
  ON product_variant_images(variant_id, sort_order, created_at, id);

CREATE UNIQUE INDEX idx_product_variant_images_one_primary
  ON product_variant_images(variant_id)
  WHERE is_primary = 1;
