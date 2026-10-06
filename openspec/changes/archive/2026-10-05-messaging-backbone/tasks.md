## 1. Platform

- [x] 1.1 Event envelope and payload schemas in contracts, with an example per type
- [x] 1.2 Broker with reconnection, topology declaration, retry tiers and DLQ
- [x] 1.3 Outbox writer and relay with SKIP LOCKED and publisher confirms
- [x] 1.4 Idempotent consumer helper
- [x] 1.5 Safe settlement when the channel closes mid-delivery, with unit tests
- [x] 1.6 Unit tests: retry, dead-letter, malformed and unknown messages

## 2. Infrastructure

- [x] 2.1 RabbitMQ pinned image, configuration and definitions in compose
- [x] 2.2 Outbox and processed_messages migrations in each service

## 3. Verification

- [x] 3.1 Integration: duplicate delivery applied once
- [x] 3.2 Chaos check: restart RabbitMQ with 8 orders in flight; all confirm, no service restarts, DLQs empty
