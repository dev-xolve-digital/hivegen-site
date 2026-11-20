-- Inquiries ("Send details"): a lead may come with only an email, plus what they need, a message and the browser's request id
-- (a repeated id is the same send). Hassan's email and the visitor's confirmation are marked when sent, for the cron retries.
ALTER TABLE leads
  MODIFY name VARCHAR(200) NULL,
  MODIFY buyer_type VARCHAR(20) NULL,
  MODIFY volume VARCHAR(100) NULL,
  ADD COLUMN needs TEXT NULL,
  ADD COLUMN message TEXT NULL,
  ADD COLUMN request_id VARCHAR(64) NULL,
  ADD COLUMN hassan_notified_at DATETIME(3) NULL,
  ADD COLUMN visitor_notified_at DATETIME(3) NULL,
  ADD UNIQUE KEY leads_request_id (request_id);
