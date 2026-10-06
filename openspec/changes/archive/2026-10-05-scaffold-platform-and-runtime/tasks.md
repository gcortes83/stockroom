## 1. Monorepo

- [x] 1.1 Root workspace: pnpm, Turborepo, strict TypeScript base config, Node 24
- [x] 1.2 ESLint flat config with the custom no-comments rule and Prettier
- [x] 1.3 Workspace skeletons for contracts, platform, four services and the web app
- [x] 1.4 Verify: build, lint and test pass from the root

## 2. Platform package

- [x] 2.1 Zod-validated configuration that fails fast
- [x] 2.2 Pino logging with redaction and request ids
- [x] 2.3 Problem+json exception filter and domain error types
- [x] 2.4 Zod validation pipe and field errors
- [x] 2.5 SQL migration runner with advisory lock
- [x] 2.6 Unit tests for config, validation pipe and request ids

## 3. Local runtime

- [x] 3.1 docker-compose with PostgreSQL, RabbitMQ and health checks
- [x] 3.2 Per-service databases and roles (`infra/postgres/init.sql`)
- [x] 3.3 Parameterized multi-stage service Dockerfile and web Dockerfile (nginx)
- [x] 3.4 Gateway with proxy routes, rate limits and security headers
- [x] 3.5 README run instructions and `.env.example`
- [x] 3.6 Verify: `docker compose up --build` reaches healthy and the smoke script passes
