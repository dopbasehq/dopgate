-- The audit log, as a tamper-evident hash chain. Every record stores its
-- position (`seq`), the hash of the record before it (`prev_hash`), and the
-- hash of its own contents (`record_hash`); app/src/services/audit_chain.rs
-- defines what is hashed.
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  actor_label TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  ip_address TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  seq INTEGER,
  prev_hash TEXT,
  record_hash TEXT
);

CREATE INDEX audit_events_created_idx ON audit_events(created_at DESC, id DESC);
CREATE INDEX audit_events_action_idx ON audit_events(action);
CREATE UNIQUE INDEX audit_events_seq_idx ON audit_events(seq);

-- Where the chain continues after retention removed records: the position
-- and hash of the newest pruned record.
CREATE TABLE audit_chain_anchor (
  id TEXT PRIMARY KEY CHECK (id = 'chain'),
  pruned_seq INTEGER NOT NULL,
  pruned_hash TEXT NOT NULL,
  pruned_at TEXT NOT NULL
);

-- When this instance started chaining. Any record without a chain position
-- that is newer than this was written outside dopgate.
CREATE TABLE audit_chain_genesis (
  id TEXT PRIMARY KEY CHECK (id = 'chain'),
  started_at TEXT NOT NULL
);

INSERT INTO audit_chain_genesis(id, started_at)
VALUES ('chain', strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'));

-- Sealed records never change. This guards against application bugs; anyone
-- with write access to the database file can drop it, which is what the
-- hash chain is for.
CREATE TRIGGER audit_events_sealed_immutable
BEFORE UPDATE ON audit_events
WHEN OLD.seq IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'sealed audit records are immutable');
END;
