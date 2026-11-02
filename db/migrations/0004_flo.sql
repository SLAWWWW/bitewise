-- 0004_flo: FLO directory, contacts, preferences, schedules, demand,
-- availability, capacities (the capacity lock row) and need assessments.
-- Day-of-week columns use ISO numbering: 1 = Monday ... 7 = Sunday.

SET LOCAL search_path = lumbung, pg_temp;

CREATE TABLE lumbung.flos (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  code                  text NOT NULL,
  name                  text NOT NULL CHECK (length(name) > 0),
  flo_type              text NOT NULL CHECK (flo_type IN ('PANTI','NON_PANTI')),
  service_model         text NOT NULL,
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED')),
  address               text,
  area                  text NOT NULL CHECK (area IN ('JAKARTA','BOGOR','DEPOK','TANGERANG','BEKASI')),
  lat                   numeric(9,6) CHECK (lat BETWEEN -90 AND 90),
  lng                   numeric(9,6) CHECK (lng BETWEEN -180 AND 180),
  location_confidence   text NOT NULL DEFAULT 'UNVERIFIED'
                        CHECK (location_confidence IN ('HIGH','MEDIUM','LOW','UNVERIFIED')),
  cooking_capable       boolean NOT NULL DEFAULT false,
  storage_capabilities  text[] NOT NULL DEFAULT '{AMBIENT}'
                        CHECK (storage_capabilities <@ ARRAY['AMBIENT','CHILLED','FROZEN']::text[]),
  halal_required        boolean NOT NULL DEFAULT false,
  allergen_exclusions   text[] NOT NULL DEFAULT '{}',
  -- Seed-internal fact (NEW FLOs have no history). Not a score.
  tenure                text NOT NULL DEFAULT 'ESTABLISHED' CHECK (tenure IN ('NEW','ESTABLISHED')),
  revision              integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK ((lat IS NULL) = (lng IS NULL))
);

-- Profile edits by the app bump the revision (optimistic concurrency).
CREATE FUNCTION lumbung.tg_flos_bump_revision() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = lumbung, pg_temp
  AS $$
  BEGIN
    IF NEW.revision = OLD.revision
       AND (NEW.name, NEW.flo_type, NEW.service_model, NEW.status, NEW.address, NEW.area, NEW.lat, NEW.lng,
            NEW.location_confidence, NEW.cooking_capable, NEW.storage_capabilities, NEW.halal_required,
            NEW.allergen_exclusions)
           IS DISTINCT FROM
           (OLD.name, OLD.flo_type, OLD.service_model, OLD.status, OLD.address, OLD.area, OLD.lat, OLD.lng,
            OLD.location_confidence, OLD.cooking_capable, OLD.storage_capabilities, OLD.halal_required,
            OLD.allergen_exclusions) THEN
      NEW.revision := OLD.revision + 1;
      NEW.updated_at := now();
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER flos_bump_revision BEFORE UPDATE ON lumbung.flos
  FOR EACH ROW EXECUTE FUNCTION lumbung.tg_flos_bump_revision();

CREATE TABLE lumbung.flo_clusters (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id      uuid NOT NULL,
  cluster_id  uuid NOT NULL,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, flo_id, cluster_id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, cluster_id) REFERENCES lumbung.clusters(tenant_id, id)
);
CREATE UNIQUE INDEX flo_clusters_one_primary ON lumbung.flo_clusters (tenant_id, flo_id) WHERE is_primary;
CREATE INDEX flo_clusters_cluster_idx ON lumbung.flo_clusters (tenant_id, cluster_id);

-- Contact addresses are AES-256-GCM encrypted by the app (CONTACT_ENC_KEY);
-- only a masked hint is stored in clear (e.g. 'sim:flo:00**').
CREATE TABLE lumbung.flo_contacts (
  id                  uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id              uuid NOT NULL,
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
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id)
);

CREATE TABLE lumbung.flo_category_prefs (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id       uuid NOT NULL,
  category_id  uuid NOT NULL,
  preference   text NOT NULL CHECK (preference IN ('ACCEPT','PREFER','EXCLUDE')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, flo_id, category_id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES lumbung.categories(tenant_id, id)
);

-- Each schedule row stands alone (never mix count bases). evidence_media_id
-- FK is added in 0006.
CREATE TABLE lumbung.service_schedules (
  id                 uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id             uuid NOT NULL,
  effective_from     date NOT NULL,
  effective_to_excl  date,
  service_dows       integer[] NOT NULL CHECK (cardinality(service_dows) > 0
                       AND service_dows <@ ARRAY[1,2,3,4,5,6,7]),
  people_per_event   integer NOT NULL CHECK (people_per_event > 0),
  count_basis        text NOT NULL CHECK (count_basis IN ('DAILY_RESIDENTS','PER_EVENT','WEEKLY_REACH')),
  declared_count     integer CHECK (declared_count >= 0),
  verified_count     integer CHECK (verified_count >= 0),
  verified_by        uuid REFERENCES lumbung.users(id),
  verified_at        timestamptz,
  evidence_media_id  uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  CHECK (effective_to_excl IS NULL OR effective_to_excl > effective_from),
  CHECK (verified_count IS NULL OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX service_schedules_flo_idx ON lumbung.service_schedules (tenant_id, flo_id, effective_from);

CREATE TABLE lumbung.category_demands (
  id             uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id         uuid NOT NULL,
  category_id    uuid NOT NULL,
  unit           text NOT NULL,
  basis          text NOT NULL CHECK (basis IN ('PER_EVENT_QTY','PER_PERSON_QTY')),
  quantity       numeric(14,3) NOT NULL CHECK (quantity > 0),
  valid_from     date NOT NULL,
  valid_to_excl  date,
  confidence     text NOT NULL DEFAULT 'MEDIUM' CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  assessor_id    uuid REFERENCES lumbung.users(id),
  confirmed_by   uuid REFERENCES lumbung.users(id),
  status         text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','CONFIRMED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES lumbung.categories(tenant_id, id),
  CHECK (valid_to_excl IS NULL OR valid_to_excl > valid_from),
  CHECK (status <> 'CONFIRMED' OR confirmed_by IS NOT NULL)
);
CREATE INDEX category_demands_lookup_idx ON lumbung.category_demands (tenant_id, flo_id, category_id, valid_from);

-- Recurring windows (RECEIVING / CONTACT: dow + local times) or dated
-- windows (CLOSURE / UNAVAILABLE: instants).
CREATE TABLE lumbung.availability_windows (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id       uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('RECEIVING','CONTACT','CLOSURE','UNAVAILABLE')),
  dow          integer CHECK (dow BETWEEN 1 AND 7),
  start_local  time,
  end_local    time,
  starts_at    timestamptz,
  ends_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  CHECK (
    (kind IN ('RECEIVING','CONTACT')
      AND dow IS NOT NULL AND start_local IS NOT NULL AND end_local IS NOT NULL AND end_local > start_local
      AND starts_at IS NULL AND ends_at IS NULL)
    OR
    (kind IN ('CLOSURE','UNAVAILABLE')
      AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at
      AND dow IS NULL AND start_local IS NULL AND end_local IS NULL)
  )
);
CREATE INDEX availability_windows_flo_idx ON lumbung.availability_windows (tenant_id, flo_id, kind);

-- The capacity lock row (A.2 lock order step 2). NULL capacity = unknown.
CREATE TABLE lumbung.flo_category_capacities (
  id                     uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id                 uuid NOT NULL,
  category_id            uuid NOT NULL,
  unit                   text NOT NULL,
  per_event_capacity     numeric(14,3) CHECK (per_event_capacity >= 0),
  distribution_capacity  numeric(14,3) CHECK (distribution_capacity >= 0),
  confirmed_at           timestamptz,
  confirmed_by           uuid REFERENCES lumbung.users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, flo_id, category_id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES lumbung.categories(tenant_id, id)
);

CREATE TABLE lumbung.need_assessments (
  id                          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                   uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  flo_id                      uuid NOT NULL,
  category_id                 uuid NOT NULL,
  score                       numeric(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
  basis                       text,
  requested_qty               numeric(14,3) CHECK (requested_qty >= 0),
  unit                        text,
  intended_distribution_date  date,
  available_stock_qty         numeric(14,3) CHECK (available_stock_qty >= 0),
  expected_deliveries_qty     numeric(14,3) CHECK (expected_deliveries_qty >= 0),
  existing_support            text,
  assessor_id                 uuid REFERENCES lumbung.users(id),
  assessed_at                 timestamptz NOT NULL,
  expires_at                  timestamptz NOT NULL,
  status                      text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','CONFIRMED')),
  confirmed_by                uuid REFERENCES lumbung.users(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES lumbung.categories(tenant_id, id),
  CHECK (expires_at > assessed_at),
  CHECK (status <> 'CONFIRMED' OR confirmed_by IS NOT NULL),
  CHECK ((requested_qty IS NULL) OR (unit IS NOT NULL))
);
CREATE INDEX need_assessments_lookup_idx ON lumbung.need_assessments (tenant_id, flo_id, category_id, assessed_at);

-- Deferred FKs for flo_access_links (table created in 0002).
ALTER TABLE lumbung.flo_access_links
  ADD FOREIGN KEY (tenant_id, flo_id) REFERENCES lumbung.flos(tenant_id, id),
  ADD FOREIGN KEY (tenant_id, contact_id) REFERENCES lumbung.flo_contacts(tenant_id, id);
