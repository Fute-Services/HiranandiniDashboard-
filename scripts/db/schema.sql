CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  staff_email TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  manager_email TEXT,
  lead_id TEXT,
  lead_name TEXT,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  at BIGINT NOT NULL,
  duration_ms BIGINT,
  device TEXT,
  location TEXT
);

CREATE INDEX IF NOT EXISTS idx_activity_staff_at ON activity_events (staff_email, at);
CREATE INDEX IF NOT EXISTS idx_activity_manager_at ON activity_events (manager_email, at);

CREATE TABLE IF NOT EXISTS staff_controls (
  email TEXT PRIMARY KEY,
  kicked BOOLEAN NOT NULL DEFAULT FALSE,
  blocked_projects TEXT[] NOT NULL DEFAULT '{}',
  -- Persists across the force-logout itself (unlike `kicked`, which is
  -- transient and self-clears the moment the live session is ejected).
  -- Only an admin/manager can flip this back off, via the "restore" action.
  login_suspended BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE staff_controls ADD COLUMN IF NOT EXISTS login_suspended BOOLEAN NOT NULL DEFAULT FALSE;
