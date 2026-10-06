## Purpose

Guarantees that a reviewer can run, reset and configure the complete system on their own machine with Docker as the only prerequisite.

## ADDED Requirements

### Requirement: One-command startup

The system SHALL start completely with `docker compose up --build` from a fresh checkout, without a `.env` file, and serve the web app on port 8080.

#### Scenario: Fresh clone starts healthy
- **WHEN** a user runs `docker compose up --build` on a clean checkout
- **THEN** PostgreSQL, RabbitMQ, catalog, orders, payments, gateway and web all report healthy and http://localhost:8080 serves the app

#### Scenario: Startup order respects dependencies
- **WHEN** the stack starts
- **THEN** each service starts only after the databases and broker it needs are healthy

### Requirement: Automatic schema migrations

Each service MUST apply its pending SQL migrations at startup before serving traffic, exactly once even if several instances start together.

#### Scenario: New migration is applied on restart
- **WHEN** a service with a new migration file starts
- **THEN** the migration is applied and recorded, and earlier migrations are not re-run

### Requirement: Isolated databases

Each service SHALL own a separate database and role, and a service's credentials MUST NOT grant access to another service's database.

#### Scenario: Cross-database access is refused
- **WHEN** the catalog role tries to connect to `orders_db`
- **THEN** the connection is refused

### Requirement: Resettable local data

The system SHALL keep data in named volumes across restarts and allow a full reset with `docker compose down -v`.

#### Scenario: Reset re-seeds the catalog
- **WHEN** a user runs `docker compose down -v` and starts the stack again
- **THEN** the databases are recreated and the example catalog is seeded again

### Requirement: Configurable host ports

Published ports SHALL be configurable through environment variables (`WEB_PORT`, `POSTGRES_PORT`, `RABBITMQ_PORT`, `RABBITMQ_UI_PORT`) with working defaults.

#### Scenario: Port conflict avoided
- **WHEN** a user sets `WEB_PORT=8090`
- **THEN** the web app is served on port 8090
