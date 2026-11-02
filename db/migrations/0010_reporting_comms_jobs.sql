-- 0010_reporting_comms_jobs: evidence obligations / submissions / reviews,
-- conversations, messages, webhooks, outbox, jobs, worker heartbeats,
-- agent runs, simulation settings.

SET LOCAL search_path = lumbung, pg_temp;

CREATE TABLE lumbung.evidence_obligations (
  id                      uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  type                    text NOT NULL CHECK (type IN ('BAST','RECEIPT_PHOTO','DISTRIBUTION')),
  subject_type            text NOT NULL CHECK (subject_type IN ('DELIVERY','DISTRIBUTION_EVENT')),
  subject_id              uuid NOT NULL,
  anchor_kind             text NOT NULL,
  anchor_at               timestamptz NOT NULL,
  due_at                  timestamptz NOT NULL,
  reminder_at             timestamptz,
  due_rule                text NOT NULL CHECK (due_rule IN ('CALENDAR_NEXT_DAY_EOD','ROLLING_24H','AT_RECEIPT')),
  timezone                text NOT NULL DEFAULT 'Asia/Jakarta',
  policy_version_id       uuid,
  state                   text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','SUBMITTED','UNDER_REVIEW',
                            'NEEDS_CLARIFICATION','ACCEPTED','REJECTED_FINAL','EXCUSED')),
  resolved_submission_id  uuid,          -- FK added below
  resolved_timeliness     text CHECK (resolved_timeliness IN ('ON_TIME','LATE','MISSING')),
  excuse_category         text,
  excuse_explanation      text,
  excused_by              uuid REFERENCES lumbung.users(id),
  excused_at              timestamptz,
  revision                integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, type, subject_id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES lumbung.policy_versions(tenant_id, id),
  CHECK (due_at >= anchor_at),
  CHECK ((type = 'DISTRIBUTION') = (subject_type = 'DISTRIBUTION_EVENT')),
  CHECK (state <> 'EXCUSED' OR (excuse_category IS NOT NULL AND excused_by IS NOT NULL AND excused_at IS NOT NULL))
);
CREATE INDEX evidence_obligations_due_idx ON lumbung.evidence_obligations (tenant_id, state, due_at);

CREATE TABLE lumbung.evidence_submissions (
  id             uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  obligation_id  uuid NOT NULL,
  version        integer NOT NULL CHECK (version > 0),
  submitted_at   timestamptz NOT NULL,
  ingested_at    timestamptz NOT NULL,
  time_source    text NOT NULL,
  channel        text NOT NULL,
  actor          uuid,
  note           text,
  supersedes_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, obligation_id, version),
  FOREIGN KEY (tenant_id, obligation_id) REFERENCES lumbung.evidence_obligations(tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES lumbung.evidence_submissions(tenant_id, id)
);

ALTER TABLE lumbung.evidence_obligations
  ADD FOREIGN KEY (tenant_id, resolved_submission_id) REFERENCES lumbung.evidence_submissions(tenant_id, id);

CREATE TABLE lumbung.submission_files (
  id             uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  submission_id  uuid NOT NULL,
  media_id       uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, submission_id, media_id),
  FOREIGN KEY (tenant_id, submission_id) REFERENCES lumbung.evidence_submissions(tenant_id, id),
  FOREIGN KEY (tenant_id, media_id) REFERENCES lumbung.media_files(tenant_id, id)
);

CREATE TABLE lumbung.evidence_reviews (
  id             uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  submission_id  uuid NOT NULL,
  reviewer_id    uuid NOT NULL REFERENCES lumbung.users(id),
  reviewed_at    timestamptz NOT NULL,
  outcome        text NOT NULL CHECK (outcome IN ('ADEQUATE','NEEDS_CLARIFICATION','REJECTED_FINAL')),
  final          boolean NOT NULL DEFAULT false,
  checklist      jsonb NOT NULL DEFAULT '{}'::jsonb,
  comments       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, submission_id) REFERENCES lumbung.evidence_submissions(tenant_id, id),
  CHECK (outcome <> 'REJECTED_FINAL' OR final)
);

CREATE TABLE lumbung.conversations (
  id                   uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  contact_kind         text NOT NULL CHECK (contact_kind IN ('FLO','DONOR','UNKNOWN')),
  flo_contact_id       uuid,
  donor_contact_id     uuid,
  channel              text NOT NULL,
  provider             text NOT NULL,
  provider_account     text,
  linked_subject_type  text,
  linked_subject_id    uuid,
  human_owner_id       uuid REFERENCES lumbung.users(id),
  agent_paused         boolean NOT NULL DEFAULT false,
  paused_at            timestamptz,
  resume_summary       text,
  state                text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','CLOSED')),
  revision             integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, flo_contact_id) REFERENCES lumbung.flo_contacts(tenant_id, id),
  FOREIGN KEY (tenant_id, donor_contact_id) REFERENCES lumbung.donor_contacts(tenant_id, id),
  CHECK (contact_kind <> 'FLO' OR flo_contact_id IS NOT NULL),
  CHECK (contact_kind <> 'DONOR' OR donor_contact_id IS NOT NULL),
  CHECK (NOT agent_paused OR paused_at IS NOT NULL)
);
CREATE INDEX conversations_flo_contact_idx ON lumbung.conversations (tenant_id, flo_contact_id);
CREATE INDEX conversations_donor_contact_idx ON lumbung.conversations (tenant_id, donor_contact_id);

CREATE TABLE lumbung.messages (
  id                   uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  conversation_id      uuid NOT NULL,
  direction            text NOT NULL CHECK (direction IN ('IN','OUT')),
  provider             text NOT NULL,
  provider_message_id  text,
  reference_code       text,
  body                 text,
  intent               text,
  parse                jsonb,
  status               text,
  is_agent_draft       boolean NOT NULL DEFAULT false,
  approved_by          uuid REFERENCES lumbung.users(id),
  correlation_id       text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES lumbung.conversations(tenant_id, id)
);
CREATE UNIQUE INDEX messages_provider_msg_uniq
  ON lumbung.messages (tenant_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX messages_conversation_idx ON lumbung.messages (tenant_id, conversation_id, created_at);

CREATE TABLE lumbung.webhook_events (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  provider          text NOT NULL,
  provider_account  text NOT NULL,
  event_id          text NOT NULL,
  payload           jsonb NOT NULL,
  state             text NOT NULL DEFAULT 'RECEIVED' CHECK (state IN ('RECEIVED','PROCESSED','FAILED')),
  attempts          integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at   timestamptz,
  received_at       timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider, provider_account, event_id)
);

CREATE TABLE lumbung.outbox (
  id                   uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  kind                 text NOT NULL CHECK (kind IN ('MESSAGE','EVENT')),
  dedupe_key           text NOT NULL,
  conversation_id      uuid,
  payload              jsonb NOT NULL,
  purpose              text,
  locale               text CHECK (locale IN ('id','en')),
  template             text,
  expires_at           timestamptz,
  state                text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','HELD_TAKEOVER','SENDING','SENT',
                         'DELIVERED','FAILED','DELIVERY_UNKNOWN','CANCELLED')),
  attempts             integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at      timestamptz,
  lease_owner          text,
  lease_expires_at     timestamptz,
  provider_message_id  text,
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES lumbung.conversations(tenant_id, id),
  CHECK (state <> 'SENDING' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX outbox_due_idx ON lumbung.outbox (state, next_attempt_at);

ALTER TABLE lumbung.offers
  ADD FOREIGN KEY (tenant_id, outbox_id) REFERENCES lumbung.outbox(tenant_id, id);

CREATE TABLE lumbung.jobs (
  id                uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind ~ '^[A-Z][A-Z0-9_]*$'),
  subject_type      text,
  subject_id        uuid,
  dedup_key         text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_at            timestamptz NOT NULL,
  state             text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','RUNNING','RETRY','DONE','DEAD')),
  attempts          integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts      integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  lease_owner       text,
  lease_expires_at  timestamptz,
  last_error        text,
  error_category    text,
  next_attempt_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dedup_key),
  CHECK (state <> 'RUNNING' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX jobs_due_idx ON lumbung.jobs (run_at) WHERE state IN ('QUEUED','RETRY');
CREATE INDEX jobs_lease_idx ON lumbung.jobs (lease_expires_at) WHERE state = 'RUNNING';
CREATE INDEX jobs_subject_idx ON lumbung.jobs (tenant_id, subject_id);

-- Global (not tenant-scoped): one row per worker process.
CREATE TABLE lumbung.worker_heartbeats (
  worker_id   text PRIMARY KEY,
  last_seen   timestamptz NOT NULL,
  version     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lumbung.agent_runs (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  trigger          text NOT NULL,
  adapter          text NOT NULL CHECK (adapter IN ('FAKE','GEMINI','DETERMINISTIC')),
  model            text,
  prompt_version   text,
  fallback_reason  text,
  tool_calls       integer NOT NULL DEFAULT 0 CHECK (tool_calls >= 0),
  latency_ms       integer CHECK (latency_ms >= 0),
  outcome          text,
  redacted_log     jsonb,
  correlation_id   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  UNIQUE (tenant_id, id)
);
CREATE INDEX agent_runs_created_idx ON lumbung.agent_runs (tenant_id, created_at);

ALTER TABLE lumbung.allocation_runs
  ADD FOREIGN KEY (tenant_id, agent_run_id) REFERENCES lumbung.agent_runs(tenant_id, id);

CREATE TABLE lumbung.agent_tool_calls (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  run_id           uuid NOT NULL,
  seq              integer NOT NULL CHECK (seq > 0),
  tool             text NOT NULL,
  args_hash        text NOT NULL,
  result_code      text,
  idempotency_key  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, run_id, seq),
  FOREIGN KEY (tenant_id, run_id) REFERENCES lumbung.agent_runs(tenant_id, id)
);

CREATE TABLE lumbung.simulation_settings (
  tenant_id   uuid PRIMARY KEY REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  llm_fault   text,
  send_fault  text,
  behaviour   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
