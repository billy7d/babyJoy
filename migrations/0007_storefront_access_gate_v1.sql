-- BabyJoy Storefront Access Gate v1.
-- Access credentials and session tokens are never persisted in raw form.
PRAGMA foreign_keys = ON;

CREATE TABLE access_links (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  session_ttl_seconds INTEGER
    CHECK (
      session_ttl_seconds IS NULL OR
      session_ttl_seconds BETWEEN 3600 AND 31536000
    ),
  created_by_email TEXT,
  updated_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  deleted_at TEXT,
  last_used_at TEXT
);

CREATE INDEX idx_access_links_status_deleted
  ON access_links(status, deleted_at, created_at DESC);

CREATE TABLE access_link_groups (
  id TEXT PRIMARY KEY,
  access_link_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  group_url TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (access_link_id) REFERENCES access_links(id) ON DELETE CASCADE
);

CREATE INDEX idx_access_link_groups_link
  ON access_link_groups(access_link_id, created_at);

CREATE TABLE access_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  access_link_id TEXT NOT NULL,
  link_version INTEGER NOT NULL,
  visitor_hash TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  FOREIGN KEY (access_link_id) REFERENCES access_links(id)
);

CREATE INDEX idx_access_sessions_link_expiry
  ON access_sessions(access_link_id, expires_at, revoked_at);

CREATE INDEX idx_access_sessions_link_version
  ON access_sessions(access_link_id, link_version);

CREATE TABLE access_link_events (
  id TEXT PRIMARY KEY,
  access_link_id TEXT NOT NULL,
  visitor_hash TEXT,
  session_id TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('LINK_OPENED', 'SESSION_ISSUED', 'SESSION_REVOKED', 'LINK_REJECTED')
  ),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (access_link_id) REFERENCES access_links(id),
  FOREIGN KEY (session_id) REFERENCES access_sessions(id)
);

CREATE INDEX idx_access_link_events_type_time
  ON access_link_events(access_link_id, event_type, created_at);

CREATE INDEX idx_access_link_events_visitor
  ON access_link_events(access_link_id, visitor_hash);

INSERT INTO app_settings (key, value, updated_at)
VALUES ('storefront_session_ttl_seconds', '1296000', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;
