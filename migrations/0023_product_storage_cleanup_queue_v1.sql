-- Lưu các key R2 cần dọn sau hard-delete để lỗi R2 có thể retry idempotent qua Cron.
CREATE TABLE product_storage_cleanup (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_product_storage_cleanup_updated
  ON product_storage_cleanup(updated_at, id);
