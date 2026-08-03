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
  login_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  -- The sessionId minted by the most recent successful login (see
  -- /api/login). A logged-in client whose own sessionId no longer matches
  -- this value has been superseded by a newer login elsewhere and is treated
  -- like a kick (see /api/controls, KickWatcher).
  current_session_id TEXT
);

ALTER TABLE staff_controls ADD COLUMN IF NOT EXISTS login_suspended BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE staff_controls ADD COLUMN IF NOT EXISTS current_session_id TEXT;

-- Real customer/lead directory, replacing the hardcoded mock array in
-- src/lib/leads.ts. lead_status covers the sales pipeline through to a final
-- outcome (Booked/Lost), so the funnel (leads -> presentations -> converted)
-- can be measured, and assigned_staff_email + the lead_reassigned activity
-- type (logged whenever a different staff member starts a session with an
-- already-assigned lead) give a traceable ownership history for disputes.
CREATE TABLE IF NOT EXISTS leads (
  lead_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  budget TEXT NOT NULL DEFAULT '',
  preferred_project TEXT NOT NULL DEFAULT '',
  lead_status TEXT NOT NULL DEFAULT 'New',
  previous_visits INT NOT NULL DEFAULT 0,
  interested_tower TEXT NOT NULL DEFAULT '',
  family_size INT NOT NULL DEFAULT 0,
  loan_requirement BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_staff_email TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone);
