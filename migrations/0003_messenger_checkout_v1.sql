-- BabyJoy Messenger Checkout v1: giữ nguyên dữ liệu và các cột Telegram lịch sử.
PRAGMA defer_foreign_keys = ON;

ALTER TABLE cart_request_items RENAME TO cart_request_items_legacy_v1;
ALTER TABLE cart_requests RENAME TO cart_requests_legacy_v1;

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
  telegram_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (telegram_status IN ('PENDING', 'SENT', 'FAILED')),
  telegram_message_id TEXT,
  telegram_last_error TEXT,
  telegram_retry_count INTEGER NOT NULL DEFAULT 0,
  contact_channel TEXT NOT NULL DEFAULT 'LEGACY' CHECK (contact_channel IN ('LEGACY', 'MESSENGER')),
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

INSERT INTO cart_requests (
  id, public_code, submission_token, customer_name, customer_phone,
  customer_contact, customer_note, item_line_count, total_quantity,
  subtotal_vnd, status, telegram_status, telegram_message_id,
  telegram_last_error, telegram_retry_count, created_at, updated_at
)
SELECT
  id, public_code, submission_token, customer_name, customer_phone,
  customer_contact, customer_note, item_line_count, total_quantity,
  subtotal_vnd, status, telegram_status, telegram_message_id,
  telegram_last_error, telegram_retry_count, created_at, updated_at
FROM cart_requests_legacy_v1;

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

INSERT INTO cart_request_items
SELECT * FROM cart_request_items_legacy_v1;

DROP TABLE cart_request_items_legacy_v1;
DROP TABLE cart_requests_legacy_v1;

CREATE INDEX idx_cart_requests_created_at ON cart_requests(created_at DESC);
CREATE INDEX idx_cart_requests_status ON cart_requests(status);
CREATE INDEX idx_cart_requests_channel_delivery ON cart_requests(contact_channel, messenger_delivery_status, created_at DESC);
CREATE INDEX idx_cart_request_items_request_id ON cart_request_items(cart_request_id);

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

CREATE INDEX idx_messenger_sessions_cart ON messenger_checkout_sessions(cart_request_id);
CREATE INDEX idx_messenger_sessions_psid ON messenger_checkout_sessions(psid);
CREATE INDEX idx_messenger_sessions_status_expiry ON messenger_checkout_sessions(status, expires_at);

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

CREATE INDEX idx_messenger_webhook_events_received ON messenger_webhook_events(received_at);

CREATE TABLE messenger_rate_limits (
  scope_key TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 1)
);

PRAGMA defer_foreign_keys = OFF;
