.PHONY: up up-tracing down reset logs smoke test test-integration e2e

up:
	docker compose up -d --build --wait

up-tracing:
	OTEL_ENABLED=true docker compose --profile observability up -d --build --wait

down:
	docker compose --profile observability down

reset:
	docker compose down -v

logs:
	docker compose logs -f catalog orders payments gateway

smoke:
	docker compose exec -T -e BASE_URL=http://web/api gateway node --input-type=module - < scripts/smoke.mjs

test:
	pnpm test

test-integration:
	pnpm test:integration

e2e:
	pnpm test:e2e
