PRAGMA foreign_keys = ON;

-- Nội dung rich là cột nullable để code cũ vẫn đọc được sản phẩm hiện tại.
ALTER TABLE products ADD COLUMN description_content TEXT;

-- Asset mô tả tách khỏi gallery; upload có thể tồn tại tạm trước lần Save đầu tiên.
CREATE TABLE product_description_assets (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
  upload_session_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  alt_text TEXT NOT NULL DEFAULT '',
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_product_description_assets_product
  ON product_description_assets(product_id, created_at, id);
CREATE INDEX idx_product_description_assets_session
  ON product_description_assets(upload_session_id, created_at, id);
CREATE INDEX idx_product_description_assets_unclaimed
  ON product_description_assets(claimed_at, created_at);
