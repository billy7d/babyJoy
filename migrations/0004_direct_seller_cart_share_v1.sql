-- BabyJoy Direct Seller Cart Share v1: mở rộng enum nhưng giữ nguyên toàn bộ lịch sử.
PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

ALTER TABLE messenger_checkout_sessions RENAME TO messenger_checkout_sessions_legacy_v2;
ALTER TABLE messenger_webhook_events RENAME TO messenger_webhook_events_legacy_v2;
ALTER TABLE cart_request_items RENAME TO cart_request_items_legacy_v2;
ALTER TABLE cart_requests RENAME TO cart_requests_legacy_v2;

CREATE TABLE cart_requests (
  id TEXT PRIMARY KEY,
  public_code TEXT NOT NULL UNIQUE,
  submission_token TEXT NOT NULL UNIQUE,
  customer_name TEXT,
  customer_phone TEXT,
  customer_contact TEXT,
  customer_note TEXT,
  item_line_count INTEGER NOT NULL,
  total_quantity INTEGER NOT NULL,
  subtotal_vnd INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'CONTACTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
  telegram_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (telegram_status IN ('NOT_APPLICABLE', 'PENDING', 'SENT', 'FAILED')),
  telegram_message_id TEXT,
  telegram_last_error TEXT,
  telegram_retry_count INTEGER NOT NULL DEFAULT 0,
  contact_channel TEXT NOT NULL DEFAULT 'LEGACY' CHECK (contact_channel IN ('LEGACY', 'MESSENGER', 'SHARE')),
  messenger_psid TEXT,
  messenger_delivery_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (messenger_delivery_status IN ('NOT_APPLICABLE', 'PENDING', 'SENDING', 'SENT', 'FAILED')),
  messenger_confirmed_at TEXT,
  messenger_last_user_interaction_at TEXT,
  messenger_sent_at TEXT,
  messenger_message_id TEXT,
  messenger_attempt_count INTEGER NOT NULL DEFAULT 0,
  messenger_last_attempt_at TEXT,
  messenger_send_claimed_at TEXT,
  messenger_last_error_code TEXT,
  messenger_last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cart_requests SELECT * FROM cart_requests_legacy_v2;

CREATE TABLE cart_request_items (
  id TEXT PRIMARY KEY,
  cart_request_id TEXT NOT NULL REFERENCES cart_requests(id) ON DELETE CASCADE,
  product_id TEXT,
  variant_id TEXT,
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT,
  image_key_snapshot TEXT,
  unit_price_vnd INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total_vnd INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cart_request_items SELECT * FROM cart_request_items_legacy_v2;

CREATE TABLE messenger_checkout_sessions (
  id TEXT PRIMARY KEY,
  cart_request_id TEXT NOT NULL,
  ref_hash TEXT NOT NULL UNIQUE,
  status_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('CREATED', 'IDENTIFIED', 'CONFIRMED', 'EXPIRED', 'CANCELLED')),
  psid TEXT,
  expires_at TEXT NOT NULL,
  identified_at TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (cart_request_id) REFERENCES cart_requests(id) ON DELETE CASCADE
);

INSERT INTO messenger_checkout_sessions SELECT * FROM messenger_checkout_sessions_legacy_v2;

CREATE TABLE messenger_webhook_events (
  event_key TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  cart_request_id TEXT,
  sender_psid_hash TEXT,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('RECEIVED', 'STATE_PERSISTED', 'PROCESSED', 'FAILED', 'IGNORED')),
  error_code TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (cart_request_id) REFERENCES cart_requests(id)
);

INSERT INTO messenger_webhook_events SELECT * FROM messenger_webhook_events_legacy_v2;

DROP TABLE messenger_checkout_sessions_legacy_v2;
DROP TABLE messenger_webhook_events_legacy_v2;
DROP TABLE cart_request_items_legacy_v2;
DROP TABLE cart_requests_legacy_v2;

CREATE INDEX idx_cart_requests_created_at ON cart_requests(created_at DESC);
CREATE INDEX idx_cart_requests_status ON cart_requests(status);
CREATE INDEX idx_cart_requests_channel_delivery ON cart_requests(contact_channel, messenger_delivery_status, created_at DESC);
CREATE INDEX idx_cart_request_items_request_id ON cart_request_items(cart_request_id);
CREATE INDEX idx_messenger_sessions_cart ON messenger_checkout_sessions(cart_request_id);
CREATE INDEX idx_messenger_sessions_psid ON messenger_checkout_sessions(psid);
CREATE INDEX idx_messenger_sessions_status_expiry ON messenger_checkout_sessions(status, expires_at);
CREATE INDEX idx_messenger_webhook_events_received ON messenger_webhook_events(received_at);

CREATE TABLE cart_share_links (
  id TEXT PRIMARY KEY,
  cart_request_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (cart_request_id) REFERENCES cart_requests(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_cart_share_token ON cart_share_links(token_hash);
CREATE INDEX idx_cart_share_expiry ON cart_share_links(expires_at);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA legacy_alter_table = OFF;
PRAGMA defer_foreign_keys = OFF;
