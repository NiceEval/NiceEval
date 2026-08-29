import { createHash } from "node:crypto";
import {
  RECORD_SQLITE_CHUNK_BYTES,
} from "./types.ts";

export const RECORD_SQLITE_PREPARED_SEAL_TEMP_SQL = `
CREATE TEMP TABLE IF NOT EXISTS niceeval_prepared_seal_raw(
  run_id TEXT NOT NULL,entry_kind TEXT NOT NULL,logical_identity TEXT NOT NULL,digest TEXT NOT NULL,
  PRIMARY KEY(run_id,entry_kind,logical_identity,digest)) WITHOUT ROWID;
CREATE TEMP TABLE IF NOT EXISTS niceeval_prepared_seal_ordered(
  run_id TEXT NOT NULL,ordinal INTEGER NOT NULL,entry_kind TEXT NOT NULL,logical_identity TEXT NOT NULL,digest TEXT NOT NULL,
  PRIMARY KEY(run_id,ordinal)) WITHOUT ROWID;`;

/** Immutable SQL owned by global Record storage migration 1. Never rewrite after publication. */
const RECORD_SQLITE_CORE_SQL = `
CREATE TABLE record_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  format TEXT NOT NULL,
  storage_revision INTEGER NOT NULL CHECK (storage_revision > 0),
  storage_generation TEXT NOT NULL,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('operational','snapshot')),
  snapshot_identity TEXT,
  snapshot_source_generation TEXT,
  snapshot_created_at TEXT,
  created_at TEXT NOT NULL,
  record_payload BLOB,
  record_digest TEXT,
  CHECK ((record_payload IS NULL) = (record_digest IS NULL)),
  CHECK (record_digest IS NULL OR length(record_digest) = 64),
  CHECK (
    (artifact_kind = 'operational' AND snapshot_identity IS NULL AND snapshot_source_generation IS NULL AND snapshot_created_at IS NULL) OR
    (artifact_kind = 'snapshot' AND snapshot_identity IS NOT NULL AND snapshot_source_generation IS NOT NULL AND snapshot_created_at IS NOT NULL)
  )
) STRICT;
CREATE TABLE coordination_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  operational_generation TEXT NOT NULL,
  next_writer_sequence INTEGER NOT NULL CHECK (next_writer_sequence > 0),
  writer_ticket_id TEXT,
  writer_sequence INTEGER CHECK (writer_sequence IS NULL OR writer_sequence > 0),
  writer_host TEXT,
  writer_pid INTEGER CHECK (writer_pid IS NULL OR writer_pid > 0),
  writer_deadline INTEGER CHECK (writer_deadline IS NULL OR writer_deadline > 0),
  writer_enqueued_at INTEGER CHECK (writer_enqueued_at IS NULL OR writer_enqueued_at > 0),
  writer_nonce TEXT,
  writer_admitted_at INTEGER CHECK (writer_admitted_at IS NULL OR writer_admitted_at > 0),
  writer_lease_expires_at INTEGER CHECK (writer_lease_expires_at IS NULL OR writer_lease_expires_at > 0),
  barrier_id TEXT,
  barrier_nonce TEXT,
  barrier_host TEXT,
  barrier_pid INTEGER CHECK (barrier_pid IS NULL OR barrier_pid > 0),
  barrier_deadline INTEGER CHECK (barrier_deadline IS NULL OR barrier_deadline > 0),
  barrier_requested_at INTEGER CHECK (barrier_requested_at IS NULL OR barrier_requested_at > 0),
  barrier_lease_expires_at INTEGER CHECK (barrier_lease_expires_at IS NULL OR barrier_lease_expires_at > 0),
  barrier_status TEXT CHECK (barrier_status IS NULL OR barrier_status IN ('requested','active')),
  barrier_active_at INTEGER CHECK (barrier_active_at IS NULL OR barrier_active_at > 0),
  CHECK ((writer_ticket_id IS NULL) = (writer_sequence IS NULL)),
  CHECK ((writer_ticket_id IS NULL) = (writer_host IS NULL)),
  CHECK ((writer_ticket_id IS NULL) = (writer_pid IS NULL)),
  CHECK ((writer_ticket_id IS NULL) = (writer_deadline IS NULL)),
  CHECK ((writer_ticket_id IS NULL) = (writer_enqueued_at IS NULL)),
  CHECK ((writer_ticket_id IS NULL) = (writer_nonce IS NULL)),
  CHECK ((writer_ticket_id IS NULL) = (writer_admitted_at IS NULL)),
  CHECK ((writer_ticket_id IS NULL) = (writer_lease_expires_at IS NULL)),
  CHECK ((barrier_id IS NULL) = (barrier_nonce IS NULL)),
  CHECK ((barrier_id IS NULL) = (barrier_host IS NULL)),
  CHECK ((barrier_id IS NULL) = (barrier_pid IS NULL)),
  CHECK ((barrier_id IS NULL) = (barrier_deadline IS NULL)),
  CHECK ((barrier_id IS NULL) = (barrier_requested_at IS NULL)),
  CHECK ((barrier_id IS NULL) = (barrier_lease_expires_at IS NULL)),
  CHECK ((barrier_id IS NULL) = (barrier_status IS NULL)),
  CHECK (
    (barrier_status IS NULL AND barrier_active_at IS NULL) OR
    (barrier_status = 'requested' AND barrier_active_at IS NULL) OR
    (barrier_status = 'active' AND barrier_active_at IS NOT NULL)
  )
) STRICT;
CREATE TABLE coordination_tickets (
  ticket_id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE CHECK (sequence > 0),
  host TEXT NOT NULL,
  pid INTEGER NOT NULL CHECK (pid > 0),
  deadline INTEGER NOT NULL CHECK (deadline > 0),
  enqueued_at INTEGER NOT NULL CHECK (enqueued_at > 0)
) STRICT;
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('open','sealing','sealed')),
  writer_generation TEXT NOT NULL,
  started_at TEXT NOT NULL,
  core_payload BLOB,
  core_digest TEXT CHECK (core_digest IS NULL OR length(core_digest) = 64),
  mutation_sequence INTEGER NOT NULL DEFAULT 0 CHECK (mutation_sequence >= 0),
  candidate_seal_identity TEXT CHECK (candidate_seal_identity IS NULL OR length(candidate_seal_identity) = 64),
  candidate_seal_entry_count INTEGER CHECK (candidate_seal_entry_count IS NULL OR candidate_seal_entry_count >= 0),
  candidate_seal_staged_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_seal_staged_count >= 0),
  logical_seal_identity TEXT,
  CHECK ((core_payload IS NULL) = (core_digest IS NULL)),
  CHECK ((candidate_seal_identity IS NULL) = (candidate_seal_entry_count IS NULL)),
  CHECK ((status = 'open') = (candidate_seal_identity IS NULL)),
  CHECK (candidate_seal_entry_count IS NULL OR candidate_seal_staged_count <= candidate_seal_entry_count),
  CHECK (status != 'open' OR candidate_seal_staged_count = 0),
  CHECK ((status = 'sealed') = (logical_seal_identity IS NOT NULL)),
  CHECK (status = 'open' OR core_payload IS NOT NULL)
) STRICT;
CREATE TABLE slots (
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  core_payload BLOB NOT NULL,
  core_digest TEXT NOT NULL CHECK (length(core_digest) = 64),
  PRIMARY KEY (run_id, slot_id),
  UNIQUE (run_id, ordinal)
) STRICT;
CREATE TABLE attempts (
  origin_run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL,
  attempt_locator TEXT NOT NULL CHECK (length(attempt_locator) = 14 AND substr(attempt_locator,1,2) = '@1'),
  core_payload BLOB,
  core_digest TEXT CHECK (core_digest IS NULL OR length(core_digest) = 64),
  CHECK ((core_payload IS NULL) = (core_digest IS NULL)),
  PRIMARY KEY (origin_run_id, attempt_id)
) STRICT;
CREATE TABLE members (
  target_run_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  origin_run_id TEXT,
  attempt_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('executed','carried','accepted','not-dispatched','interrupted')),
  core_payload BLOB NOT NULL,
  core_digest TEXT NOT NULL CHECK (length(core_digest) = 64),
  PRIMARY KEY (target_run_id, slot_id),
  CHECK (
    (action IN ('executed','carried','accepted') AND origin_run_id IS NOT NULL AND attempt_id IS NOT NULL) OR
    (action IN ('not-dispatched','interrupted') AND origin_run_id IS NULL AND attempt_id IS NULL)
  ),
  FOREIGN KEY (target_run_id, slot_id) REFERENCES slots(run_id, slot_id) ON DELETE CASCADE,
  FOREIGN KEY (origin_run_id, attempt_id) REFERENCES attempts(origin_run_id, attempt_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE attachments (
  attachment_id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('run','attempt')),
  owner_run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  owner_attempt_id TEXT,
  family TEXT NOT NULL,
  family_revision INTEGER NOT NULL CHECK (family_revision > 0),
  logical_identity TEXT,
  canonical_payload BLOB,
  canonical_digest TEXT CHECK (canonical_digest IS NULL OR length(canonical_digest) = 64),
  logical_inventory BLOB,
  inventory_digest TEXT CHECK (inventory_digest IS NULL OR length(inventory_digest) = 64),
  CHECK ((canonical_payload IS NULL) = (canonical_digest IS NULL)),
  CHECK ((logical_inventory IS NULL) = (inventory_digest IS NULL)),
  CHECK ((owner_kind = 'run' AND owner_attempt_id IS NULL) OR (owner_kind = 'attempt' AND owner_attempt_id IS NOT NULL)),
  UNIQUE (owner_kind, owner_run_id, owner_attempt_id, family),
  FOREIGN KEY (owner_run_id, owner_attempt_id) REFERENCES attempts(origin_run_id, attempt_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE attachment_references (
  attachment_id TEXT NOT NULL REFERENCES attachments(attachment_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  target_owner_kind TEXT NOT NULL CHECK (target_owner_kind IN ('run','attempt')),
  target_family TEXT NOT NULL,
  canonical_payload BLOB NOT NULL,
  reference_digest TEXT NOT NULL CHECK (length(reference_digest) = 64),
  PRIMARY KEY (attachment_id, ordinal)
) STRICT;
CREATE TABLE collection_items (
  attachment_id TEXT NOT NULL REFERENCES attachments(attachment_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  logical_identity TEXT NOT NULL,
  canonical_payload BLOB NOT NULL,
  canonical_digest TEXT NOT NULL CHECK (length(canonical_digest) = 64),
  PRIMARY KEY (attachment_id, ordinal),
  UNIQUE (attachment_id, logical_identity)
) STRICT;
CREATE TABLE contents (
  content_id TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL REFERENCES attachments(attachment_id) ON DELETE CASCADE,
  logical_handle TEXT NOT NULL,
  byte_length INTEGER CHECK (byte_length IS NULL OR byte_length >= 0),
  overall_digest TEXT CHECK (overall_digest IS NULL OR length(overall_digest) = 64),
  chunk_count INTEGER CHECK (chunk_count IS NULL OR chunk_count >= 0),
  CHECK ((byte_length IS NULL) = (overall_digest IS NULL) AND (overall_digest IS NULL) = (chunk_count IS NULL)),
  UNIQUE (attachment_id, logical_handle)
) STRICT;
CREATE TABLE content_chunks (
  content_id TEXT NOT NULL REFERENCES contents(content_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  bytes BLOB NOT NULL CHECK (length(bytes) <= ${RECORD_SQLITE_CHUNK_BYTES}),
  chunk_digest TEXT NOT NULL CHECK (length(chunk_digest) = 64),
  PRIMARY KEY (content_id, ordinal)
) STRICT;
CREATE TABLE run_seal_entries (
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('record','run','slot','member','attempt','attachment','attachment-reference','collection-item','content','content-chunk')),
  logical_identity TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  PRIMARY KEY (run_id, ordinal),
  UNIQUE (run_id, entry_kind, logical_identity)
) STRICT;
CREATE INDEX attachments_owner_family ON attachments(owner_kind, owner_run_id, owner_attempt_id, family);
CREATE UNIQUE INDEX attachments_owner_family_unique ON attachments(owner_kind, owner_run_id, coalesce(owner_attempt_id,''), family);
CREATE INDEX members_origin_attempt ON members(origin_run_id, attempt_id, target_run_id);
CREATE INDEX attempts_locator ON attempts(attempt_locator, origin_run_id, attempt_id);
CREATE INDEX references_target_family ON attachment_references(target_owner_kind, target_family);
CREATE INDEX content_chunks_page ON content_chunks(content_id, ordinal);
CREATE INDEX coordination_tickets_fifo ON coordination_tickets(sequence);
CREATE TRIGGER runs_sealed_update BEFORE UPDATE ON runs WHEN OLD.status = 'sealed' BEGIN SELECT RAISE(ABORT, 'sealed run is immutable'); END;
CREATE TRIGGER runs_sealed_delete BEFORE DELETE ON runs WHEN OLD.status = 'sealed' BEGIN SELECT RAISE(ABORT, 'sealed run is immutable'); END;
CREATE TRIGGER slots_sealed_insert BEFORE INSERT ON slots WHEN (SELECT status FROM runs WHERE run_id = NEW.run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER slots_sealed_update BEFORE UPDATE ON slots WHEN (SELECT status FROM runs WHERE run_id = OLD.run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER slots_sealed_delete BEFORE DELETE ON slots WHEN (SELECT status FROM runs WHERE run_id = OLD.run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER attempts_sealed_insert BEFORE INSERT ON attempts WHEN (SELECT status FROM runs WHERE run_id = NEW.origin_run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER attempts_sealed_update BEFORE UPDATE ON attempts WHEN (SELECT status FROM runs WHERE run_id = OLD.origin_run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER attempts_sealed_delete BEFORE DELETE ON attempts WHEN (SELECT status FROM runs WHERE run_id = OLD.origin_run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER members_sealed_insert BEFORE INSERT ON members WHEN (SELECT status FROM runs WHERE run_id = NEW.target_run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER members_sealed_update BEFORE UPDATE ON members WHEN (SELECT status FROM runs WHERE run_id = OLD.target_run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER members_sealed_delete BEFORE DELETE ON members WHEN (SELECT status FROM runs WHERE run_id = OLD.target_run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER attachments_sealed_insert BEFORE INSERT ON attachments WHEN (SELECT status FROM runs WHERE run_id = NEW.owner_run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER attachments_sealed_update BEFORE UPDATE ON attachments WHEN (SELECT status FROM runs WHERE run_id = OLD.owner_run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER attachments_sealed_delete BEFORE DELETE ON attachments WHEN (SELECT status FROM runs WHERE run_id = OLD.owner_run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER references_sealed_insert BEFORE INSERT ON attachment_references WHEN (SELECT r.status FROM attachments a JOIN runs r ON r.run_id=a.owner_run_id WHERE a.attachment_id=NEW.attachment_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER references_sealed_update BEFORE UPDATE ON attachment_references WHEN (SELECT r.status FROM attachments a JOIN runs r ON r.run_id=a.owner_run_id WHERE a.attachment_id=OLD.attachment_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER references_sealed_delete BEFORE DELETE ON attachment_references WHEN (SELECT r.status FROM attachments a JOIN runs r ON r.run_id=a.owner_run_id WHERE a.attachment_id=OLD.attachment_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER items_sealed_insert BEFORE INSERT ON collection_items WHEN (SELECT r.status FROM attachments a JOIN runs r ON r.run_id=a.owner_run_id WHERE a.attachment_id=NEW.attachment_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER items_sealed_update BEFORE UPDATE ON collection_items WHEN (SELECT r.status FROM attachments a JOIN runs r ON r.run_id=a.owner_run_id WHERE a.attachment_id=OLD.attachment_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER items_sealed_delete BEFORE DELETE ON collection_items WHEN (SELECT r.status FROM attachments a JOIN runs r ON r.run_id=a.owner_run_id WHERE a.attachment_id=OLD.attachment_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER contents_sealed_insert BEFORE INSERT ON contents WHEN (SELECT r.status FROM attachments a JOIN runs r ON r.run_id=a.owner_run_id WHERE a.attachment_id=NEW.attachment_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER contents_sealed_update BEFORE UPDATE ON contents WHEN (SELECT r.status FROM attachments a JOIN runs r ON r.run_id=a.owner_run_id WHERE a.attachment_id=OLD.attachment_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER contents_sealed_delete BEFORE DELETE ON contents WHEN (SELECT r.status FROM attachments a JOIN runs r ON r.run_id=a.owner_run_id WHERE a.attachment_id=OLD.attachment_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER chunks_sealed_insert BEFORE INSERT ON content_chunks WHEN (SELECT r.status FROM contents c JOIN attachments a ON a.attachment_id=c.attachment_id JOIN runs r ON r.run_id=a.owner_run_id WHERE c.content_id=NEW.content_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER chunks_sealed_update BEFORE UPDATE ON content_chunks WHEN (SELECT r.status FROM contents c JOIN attachments a ON a.attachment_id=c.attachment_id JOIN runs r ON r.run_id=a.owner_run_id WHERE c.content_id=OLD.content_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER chunks_sealed_delete BEFORE DELETE ON content_chunks WHEN (SELECT r.status FROM contents c JOIN attachments a ON a.attachment_id=c.attachment_id JOIN runs r ON r.run_id=a.owner_run_id WHERE c.content_id=OLD.content_id) != 'open' BEGIN SELECT RAISE(ABORT, 'run closure is immutable'); END;
CREATE TRIGGER seal_entries_sealed_insert BEFORE INSERT ON run_seal_entries WHEN (SELECT status FROM runs WHERE run_id = NEW.run_id) != 'sealing' BEGIN SELECT RAISE(ABORT, 'Seal candidates require sealing state'); END;
CREATE TRIGGER seal_entries_sealed_update BEFORE UPDATE ON run_seal_entries BEGIN SELECT RAISE(ABORT, 'Seal entries are immutable'); END;
CREATE TRIGGER seal_entries_sealed_delete BEFORE DELETE ON run_seal_entries WHEN (SELECT status FROM runs WHERE run_id = OLD.run_id) != 'open' BEGIN SELECT RAISE(ABORT, 'Seal entries are immutable'); END;
`;

/** Run publication storage included in the 0.14 baseline. */
const RECORD_SQLITE_RUN_SQL = `
CREATE TABLE run_publication_clock (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0)
) STRICT;
CREATE TABLE run_resources (
  run_id TEXT PRIMARY KEY,
  invocation_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  initial_writer_generation TEXT NOT NULL,
  current_writer_generation TEXT NOT NULL,
  terminal_state TEXT CHECK (terminal_state IS NULL OR terminal_state IN ('completed','interrupted','failed')),
  completed_at TEXT,
  created_revision INTEGER NOT NULL UNIQUE CHECK (created_revision > 0),
  close_revision INTEGER UNIQUE CHECK (close_revision IS NULL OR close_revision > created_revision),
  CHECK ((terminal_state IS NULL) = (completed_at IS NULL)),
  CHECK ((terminal_state IS NULL) = (close_revision IS NULL))
) STRICT;
CREATE TABLE run_expected_slots (
  run_id TEXT NOT NULL REFERENCES run_resources(run_id) ON DELETE RESTRICT,
  slot_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  eval_id TEXT NOT NULL,
  attempt_ordinal INTEGER NOT NULL CHECK (attempt_ordinal >= 0),
  execution_identity_digest TEXT NOT NULL CHECK (length(execution_identity_digest) = 64),
  PRIMARY KEY (run_id, slot_id),
  UNIQUE (run_id, ordinal)
) STRICT;
CREATE TABLE attempt_publications (
  attempt_id TEXT PRIMARY KEY,
  attempt_locator TEXT NOT NULL CHECK (length(attempt_locator) = 14 AND substr(attempt_locator,1,2) = '@1'),
  origin_run_id TEXT NOT NULL,
  origin_slot_id TEXT NOT NULL,
  closure_payload BLOB NOT NULL,
  closure_digest TEXT NOT NULL CHECK (length(closure_digest) = 64),
  published_revision INTEGER NOT NULL UNIQUE CHECK (published_revision > 0),
  FOREIGN KEY (origin_run_id, origin_slot_id) REFERENCES run_expected_slots(run_id, slot_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE run_slot_bindings (
  target_run_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES attempt_publications(attempt_id) ON DELETE RESTRICT,
  origin_run_id TEXT NOT NULL,
  origin_slot_id TEXT NOT NULL,
  attempt_publication_revision INTEGER NOT NULL CHECK (attempt_publication_revision > 0),
  action TEXT NOT NULL CHECK (action IN ('executed','carried','accepted')),
  binding_revision INTEGER NOT NULL UNIQUE CHECK (binding_revision > 0),
  PRIMARY KEY (target_run_id, slot_id),
  FOREIGN KEY (target_run_id, slot_id) REFERENCES run_expected_slots(run_id, slot_id) ON DELETE RESTRICT,
  FOREIGN KEY (origin_run_id, origin_slot_id) REFERENCES run_expected_slots(run_id, slot_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE run_slot_absences (
  run_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('early-exit-satisfied','budget-exhausted','stopped-by-failure','interrupted-before-publication','dispatch-failed')),
  absence_revision INTEGER NOT NULL CHECK (absence_revision > 0),
  PRIMARY KEY (run_id, slot_id),
  FOREIGN KEY (run_id, slot_id) REFERENCES run_expected_slots(run_id, slot_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE run_recoveries (
  run_id TEXT PRIMARY KEY REFERENCES run_resources(run_id) ON DELETE RESTRICT,
  previous_writer_generation TEXT NOT NULL,
  recovery_writer_generation TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  evidence_identity TEXT NOT NULL,
  evidence_observed_at TEXT NOT NULL,
  recovery_revision INTEGER NOT NULL UNIQUE CHECK (recovery_revision > 0)
) STRICT;
CREATE TABLE run_deletion_tombstones (
  run_id TEXT PRIMARY KEY REFERENCES run_resources(run_id) ON DELETE RESTRICT,
  terminal_state TEXT NOT NULL CHECK (terminal_state IN ('completed','interrupted','failed')),
  deleted_at TEXT NOT NULL,
  deletion_revision INTEGER NOT NULL UNIQUE CHECK (deletion_revision > 0)
) STRICT;
CREATE INDEX run_resources_list ON run_resources(created_revision, run_id);
CREATE INDEX run_resources_invocation ON run_resources(invocation_id, created_revision, run_id);
CREATE INDEX attempt_publications_origin ON attempt_publications(origin_run_id, origin_slot_id);
CREATE INDEX attempt_publications_locator ON attempt_publications(attempt_locator, origin_run_id, attempt_id);
CREATE INDEX run_slot_bindings_attempt ON run_slot_bindings(attempt_id, target_run_id, slot_id);
CREATE INDEX run_deletion_revision ON run_deletion_tombstones(deletion_revision, run_id);
INSERT INTO run_publication_clock(singleton,revision) VALUES (1,0);
`;

/** Immutable, complete ProjectDatabase 0.14 baseline. Never rewrite after publication. */
export const RECORD_SQLITE_REVISION_1_SQL = `${RECORD_SQLITE_CORE_SQL}\n${RECORD_SQLITE_RUN_SQL}`;

export const RECORD_SQLITE_SCHEMA_SQL = RECORD_SQLITE_REVISION_1_SQL;

export const RECORD_SQLITE_REVISION_1_DIGEST = createHash("sha256")
  .update("niceeval.record.storage-migration/v1\0")
  .update(RECORD_SQLITE_REVISION_1_SQL)
  .digest("hex");
