-- Lưu mã truy cập ngắn dưới dạng hash; nonce cho phép Worker tái tạo URL từ secret.
PRAGMA foreign_keys = ON;

CREATE TABLE access_link_codes (
  code_hash TEXT NOT NULL UNIQUE,
  access_link_id TEXT NOT NULL,
  link_version INTEGER NOT NULL CHECK (link_version >= 1),
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (access_link_id, link_version),
  FOREIGN KEY (access_link_id) REFERENCES access_links(id) ON DELETE CASCADE
);

CREATE INDEX idx_access_link_codes_link_status
  ON access_link_codes(access_link_id, revoked_at, link_version);
