CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE categories (
  id          uuid PRIMARY KEY,
  name        citext NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id            uuid PRIMARY KEY,
  sku           text NOT NULL,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description   text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  category_id   uuid NOT NULL REFERENCES categories(id),
  price_cents   bigint NOT NULL CHECK (price_cents >= 0),
  currency      char(3) NOT NULL DEFAULT 'USD',
  stock         integer NOT NULL CHECK (stock >= 0),
  reserved      integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  weight_grams  integer NULL CHECK (weight_grams IS NULL OR weight_grams >= 0),
  version       integer NOT NULL DEFAULT 1,
  search_vector tsvector GENERATED ALWAYS AS (
                  setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(sku, '')), 'A') ||
                  setweight(to_tsvector('english', coalesce(description, '')), 'B')
                ) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz NULL,
  CONSTRAINT products_sku_key UNIQUE (sku),
  CONSTRAINT products_reserved_not_above_stock CHECK (reserved <= stock)
);

CREATE INDEX products_search_vector_idx ON products USING gin (search_vector);
CREATE INDEX products_name_trgm_idx ON products USING gin (name gin_trgm_ops);
CREATE INDEX products_sku_trgm_idx ON products USING gin (sku gin_trgm_ops);
CREATE INDEX products_category_idx ON products (category_id) WHERE deleted_at IS NULL;
CREATE INDEX products_price_idx ON products (price_cents) WHERE deleted_at IS NULL;
CREATE INDEX products_created_idx ON products (created_at DESC, id) WHERE deleted_at IS NULL;

CREATE TYPE reservation_status AS ENUM ('RESERVED', 'COMMITTED', 'RELEASED', 'EXPIRED');

CREATE TABLE stock_reservations (
  id          uuid PRIMARY KEY,
  order_id    uuid NOT NULL,
  product_id  uuid NOT NULL REFERENCES products(id),
  quantity    integer NOT NULL CHECK (quantity > 0),
  status      reservation_status NOT NULL,
  expires_at  timestamptz NOT NULL,
  correlation_id text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_id)
);
CREATE INDEX stock_reservations_expiry_idx ON stock_reservations (expires_at) WHERE status = 'RESERVED';
CREATE INDEX stock_reservations_order_idx ON stock_reservations (order_id);

CREATE TYPE import_status AS ENUM ('PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');
CREATE TYPE issue_severity AS ENUM ('ERROR', 'WARNING');

CREATE TABLE import_jobs (
  id               uuid PRIMARY KEY,
  filename         text NOT NULL,
  size_bytes       integer NOT NULL DEFAULT 0,
  status           import_status NOT NULL,
  source           text NOT NULL DEFAULT 'UPLOAD' CHECK (source IN ('UPLOAD', 'SEED')),
  total_lines      integer NOT NULL DEFAULT 0,
  blank_lines      integer NOT NULL DEFAULT 0,
  processed_rows   integer NOT NULL DEFAULT 0,
  created_count    integer NOT NULL DEFAULT 0,
  updated_count    integer NOT NULL DEFAULT 0,
  unchanged_count  integer NOT NULL DEFAULT 0,
  rejected_count   integer NOT NULL DEFAULT 0,
  warning_count    integer NOT NULL DEFAULT 0,
  failure_message  text NULL,
  started_at       timestamptz NOT NULL,
  finished_at      timestamptz NULL
);
CREATE INDEX import_jobs_started_idx ON import_jobs (started_at DESC);

CREATE TABLE import_row_issues (
  id          uuid PRIMARY KEY,
  job_id      uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  line        integer NOT NULL,
  sku         text NULL,
  field       text NULL,
  value       text NULL,
  code        text NOT NULL,
  message     text NOT NULL,
  severity    issue_severity NOT NULL
);
CREATE INDEX import_row_issues_job_idx ON import_row_issues (job_id, line);

CREATE TABLE outbox (
  id              uuid PRIMARY KEY,
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  correlation_id  text NOT NULL,
  causation_id    text NULL,
  occurred_at     timestamptz NOT NULL,
  published_at    timestamptz NULL,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text NULL
);
CREATE INDEX outbox_unpublished_idx ON outbox (occurred_at, id) WHERE published_at IS NULL;

CREATE TABLE processed_messages (
  message_id    uuid NOT NULL,
  consumer      text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, consumer)
);
