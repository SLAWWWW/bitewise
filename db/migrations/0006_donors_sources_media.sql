-- 0006_donors_sources_media: donors, donor contacts, source and storage
-- locations, private media metadata.

SET LOCAL search_path = lumbung, pg_temp;

CREATE TABLE lumbung.donors (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL CHECK (length(name) > 0),
  kind        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

-- Same encryption scheme as flo_contacts.
CREATE TABLE lumbung.donor_contacts (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  donor_id            uuid NOT NULL,
  channel             text NOT NULL CHECK (channel IN ('SIM','WHATSAPP','EMAIL')),
  address_ciphertext  bytea NOT NULL,
  address_hint        text NOT NULL,
  role                text,
  verification_state  text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_state IN ('UNVERIFIED','VERIFIED','FAILED')),
  consent_state       text NOT NULL DEFAULT 'UNKNOWN' CHECK (consent_state IN ('UNKNOWN','GRANTED','WITHDRAWN')),
  opted_out_at        timestamptz,
  contact_hours       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, donor_id) REFERENCES lumbung.donors(tenant_id, id)
);

-- DONOR_SITE belongs to a donor; WAREHOUSE is a FoodCycle site (no donor).
CREATE TABLE lumbung.source_locations (
  id                   uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  code                 text NOT NULL,
  name                 text,
  donor_id             uuid,
  kind                 text NOT NULL CHECK (kind IN ('DONOR_SITE','WAREHOUSE')),
  address              text,
  cluster_id           uuid,
  lat                  numeric(9,6) CHECK (lat BETWEEN -90 AND 90),
  lng                  numeric(9,6) CHECK (lng BETWEEN -180 AND 180),
  location_confidence  text NOT NULL DEFAULT 'UNVERIFIED'
                       CHECK (location_confidence IN ('HIGH','MEDIUM','LOW','UNVERIFIED')),
  hours                jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, donor_id) REFERENCES lumbung.donors(tenant_id, id),
  FOREIGN KEY (tenant_id, cluster_id) REFERENCES lumbung.clusters(tenant_id, id),
  CHECK ((kind = 'DONOR_SITE') = (donor_id IS NOT NULL)),
  CHECK ((lat IS NULL) = (lng IS NULL))
);

CREATE TABLE lumbung.storage_locations (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  warehouse_id     uuid NOT NULL,
  code             text NOT NULL,
  storage_profile  text NOT NULL CHECK (storage_profile IN ('AMBIENT','CHILLED','FROZEN')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, warehouse_id, code),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES lumbung.source_locations(tenant_id, id)
);

-- Private media metadata; bytes live under MEDIA_DIR/{tenant}/{yyyy}/{id}.
CREATE TABLE lumbung.media_files (
  id                     uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  storage_key            text NOT NULL,
  sha256                 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  mime                   text NOT NULL,
  bytes                  bigint NOT NULL CHECK (bytes >= 0),
  uploader_actor         uuid,
  uploaded_at            timestamptz NOT NULL,
  captured_at            timestamptz,
  sensitivity            text NOT NULL DEFAULT 'NORMAL' CHECK (sensitivity IN ('NORMAL','SENSITIVE')),
  purpose                text NOT NULL,
  retention_until        timestamptz,
  deletion_state         text NOT NULL DEFAULT 'ACTIVE' CHECK (deletion_state IN ('ACTIVE','DELETED')),
  duplicate_of_media_id  uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, storage_key),
  FOREIGN KEY (tenant_id, duplicate_of_media_id) REFERENCES lumbung.media_files(tenant_id, id),
  CHECK (duplicate_of_media_id IS NULL OR duplicate_of_media_id <> id)
);
CREATE INDEX media_files_sha256_idx ON lumbung.media_files (tenant_id, sha256);

-- Deferred media FKs from earlier migrations.
ALTER TABLE lumbung.agreements
  ADD FOREIGN KEY (tenant_id, document_media_id) REFERENCES lumbung.media_files(tenant_id, id);
ALTER TABLE lumbung.service_schedules
  ADD FOREIGN KEY (tenant_id, evidence_media_id) REFERENCES lumbung.media_files(tenant_id, id);
