-- 0003_reference: categories, products, unit conversions, clusters.

SET LOCAL search_path = lumbung, pg_temp;

CREATE TABLE lumbung.categories (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  code             text NOT NULL CHECK (code IN ('BREAD','PREPARED_MEAL','PRODUCE','RICE','SNACK','STAPLE')),
  name_id          text NOT NULL,
  name_en          text NOT NULL,
  comparable_unit  text NOT NULL,
  perishability    text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE lumbung.products (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  code             text NOT NULL,
  name             text NOT NULL,
  category_id      uuid NOT NULL,
  base_unit        text NOT NULL,
  unit_kind        text NOT NULL CHECK (unit_kind IN ('COUNT','MASS','VOLUME')),
  min_increment    numeric(14,3) NOT NULL DEFAULT 1 CHECK (min_increment > 0),
  allergens        text[] NOT NULL DEFAULT '{}',
  storage_profile  text NOT NULL CHECK (storage_profile IN ('AMBIENT','CHILLED','FROZEN')),
  halal_status     text NOT NULL DEFAULT 'UNKNOWN' CHECK (halal_status IN ('HALAL','NON_HALAL','UNKNOWN')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, category_id) REFERENCES lumbung.categories(tenant_id, id),
  CHECK (unit_kind <> 'COUNT' OR min_increment = trunc(min_increment))
);

-- SKU- and version-specific conversions; kg->portion is an approved
-- estimate with a source, never a universal constant (PRD §7).
CREATE TABLE lumbung.unit_conversions (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL,
  from_unit   text NOT NULL,
  to_unit     text NOT NULL,
  factor      numeric(18,6) NOT NULL CHECK (factor > 0),
  provenance  text NOT NULL CHECK (provenance IN ('MEASURED','ESTIMATED','APPROVED_ESTIMATE')),
  version     integer NOT NULL DEFAULT 1 CHECK (version > 0),
  source      text,
  valid_from  timestamptz,
  valid_to    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, product_id, from_unit, to_unit, version),
  FOREIGN KEY (tenant_id, product_id) REFERENCES lumbung.products(tenant_id, id),
  CHECK (from_unit <> to_unit),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);

CREATE TABLE lumbung.clusters (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES lumbung.tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  area        text NOT NULL CHECK (area IN ('JAKARTA','BOGOR','DEPOK','TANGERANG','BEKASI')),
  lat         numeric(9,6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         numeric(9,6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_km   numeric(6,2) NOT NULL CHECK (radius_km > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);
