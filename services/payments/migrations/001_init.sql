CREATE TYPE payment_outcome AS ENUM ('APPROVE', 'DECLINE', 'FAIL_ONCE');
CREATE TYPE payment_status AS ENUM ('SUCCEEDED', 'FAILED', 'REFUNDED');

CREATE TABLE payment_methods (
  id                  text PRIMARY KEY,
  brand               text NOT NULL,
  last4               char(4) NOT NULL,
  exp_month           smallint NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year            smallint NOT NULL,
  holder_name         text NOT NULL,
  simulated_outcome   payment_outcome NOT NULL,
  decline_reason      text NULL,
  failures_remaining  integer NOT NULL DEFAULT 0,
  expires_at          timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id                 uuid PRIMARY KEY,
  order_id           uuid NOT NULL,
  payment_method_id  text NULL REFERENCES payment_methods(id),
  amount_cents       bigint NOT NULL CHECK (amount_cents >= 0),
  currency           char(3) NOT NULL,
  status             payment_status NOT NULL,
  decline_reason     text NULL,
  last4              char(4) NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_order_id_key UNIQUE (order_id)
);

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
