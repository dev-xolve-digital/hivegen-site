-- The booking tables. One statement per semicolon, and comments on lines of their own:
-- the migrator (src/server/store/migrate.ts) splits this file at semicolons.
-- Every time is DATETIME(3) in UTC: the store always passes the time in, the database clock is never used.
-- Tokens and ids are compared exactly (utf8mb4_bin), because upper and lower case letters differ in them.

CREATE TABLE IF NOT EXISTS leads (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(22) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(320) NOT NULL,
  phone VARCHAR(50) NULL,
  buyer_type VARCHAR(20) NOT NULL,
  volume VARCHAR(100) NOT NULL,
  footage_url VARCHAR(2048) NULL,
  page_version VARCHAR(20) NOT NULL,
  attribution TEXT NOT NULL,
  fbp VARCHAR(255) NULL,
  fbc VARCHAR(512) NULL,
  client_ip VARCHAR(64) NULL,
  user_agent TEXT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'started',
  new_lead_notified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY public_id (public_id),
  KEY leads_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- slot_key is the start (as text) while the booking is booked or requested, and NULL once it is cancelled.
-- active_lead_id is the lead while the booking is active, and NULL once it is cancelled.
-- A unique key on each (NULLs never collide) is what guarantees one active booking per start and per lead, even for simultaneous requests.
CREATE TABLE IF NOT EXISTS bookings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id INT UNSIGNED NOT NULL,
  start_utc DATETIME(3) NOT NULL,
  end_utc DATETIME(3) NOT NULL,
  visitor_tz VARCHAR(64) NOT NULL,
  status VARCHAR(12) NOT NULL,
  manage_token CHAR(43) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  google_event_id VARCHAR(1024) NULL,
  meet_url VARCHAR(512) NULL,
  reminder_24h_sent_at DATETIME(3) NULL,
  reminder_1h_sent_at DATETIME(3) NULL,
  visitor_notified_at DATETIME(3) NULL,
  hassan_notified_at DATETIME(3) NULL,
  slot_key VARCHAR(30) NULL,
  active_lead_id INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY manage_token (manage_token),
  UNIQUE KEY slot_key (slot_key),
  UNIQUE KEY active_lead_id (active_lead_id),
  KEY bookings_lead_id (lead_id),
  KEY bookings_start_utc (start_utc),
  KEY bookings_created_at (created_at),
  CONSTRAINT bookings_lead_fk FOREIGN KEY (lead_id) REFERENCES leads (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Not tied to leads: an event may be recorded for a visitor who has no lead yet.
CREATE TABLE IF NOT EXISTS tracking_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(32) NOT NULL,
  lead_id INT UNSIGNED NULL,
  payload LONGTEXT NULL,
  status VARCHAR(10) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  error TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY event_id (event_id),
  KEY tracking_events_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
