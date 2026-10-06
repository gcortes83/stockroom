CREATE TYPE order_status AS ENUM ('PENDING', 'AWAITING_PAYMENT', 'CONFIRMED', 'CANCELLED');

CREATE TABLE orders (
  id                      uuid PRIMARY KEY,
  status                  order_status NOT NULL,
  customer_name           text NOT NULL,
  customer_email          text NOT NULL,
  currency                char(3) NOT NULL DEFAULT 'USD',
  total_cents             bigint NOT NULL CHECK (total_cents >= 0),
  payment_method_id       text NOT NULL,
  payment_status          text NULL CHECK (payment_status IN ('SUCCEEDED', 'FAILED', 'REFUNDED')),
  payment_last4           char(4) NULL,
  payment_decline_reason  text NULL,
  cancel_reason           text NULL,
  cancel_detail           jsonb NULL,
  idempotency_key         uuid NOT NULL,
  request_hash            char(64) NOT NULL,
  correlation_id          text NOT NULL,
  version                 integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key)
);
CREATE INDEX orders_status_created_idx ON orders (status, created_at DESC);
CREATE INDEX orders_created_idx ON orders (created_at DESC);

CREATE TABLE order_lines (
  id                uuid PRIMARY KEY,
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL,
  sku               text NOT NULL,
  name              text NOT NULL,
  unit_price_cents  bigint NOT NULL CHECK (unit_price_cents >= 0),
  quantity          integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  line_total_cents  bigint NOT NULL CHECK (line_total_cents >= 0),
  position          integer NOT NULL,
  UNIQUE (order_id, product_id)
);

CREATE TABLE order_status_history (
  id           uuid PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status  order_status NULL,
  to_status    order_status NOT NULL,
  reason       text NULL,
  occurred_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, occurred_at);

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
