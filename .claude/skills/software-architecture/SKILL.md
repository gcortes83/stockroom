---
name: software-architecture
description: Senior-architect guidance for Stockroom — bounded contexts, C4 diagrams, ADRs, quality attributes and trade-off analysis. Use when designing a feature, choosing between technologies, writing design.md for an OpenSpec change, or documenting decisions/alternatives for the README.
---

# Software Architecture

## Mindset
- Start from requirements and quality attributes, not from technology. For every decision state: context, options, trade-offs, decision, consequences.
- Prefer reversible decisions. Mark irreversible ones (data model, service boundaries, money representation) and spend more time on them.
- Every "enterprise" mechanism must earn its place. If it adds operational weight, document why it is worth it for this challenge.
- Surface ambiguity as explicit questions or assumptions; the evaluators score this.

## Bounded contexts
| Context | Owns | Service |
|---|---|---|
| Catalog | Product, Category, SKU uniqueness, search index, CSV import jobs | catalog |
| Inventory | Stock levels, reservations (lives inside catalog to avoid a distributed stock problem) | catalog |
| Ordering | Cart snapshot, Order, OrderLine, order state machine, checkout saga | orders |
| Payments | PaymentAttempt, fake provider rules, refunds | payments |
| Edge | Routing, request-id, rate limit, aggregated OpenAPI | gateway |

Ubiquitous language: `Product`, `SKU`, `Stock`, `Reservation`, `Order`, `OrderLine`, `Payment`, `ImportJob`, `ImportRowError`. Use these names in code, specs and UI.

## Quality attributes to design for
1. **Correctness of stock and money** — no overselling, no float money, idempotent purchase.
2. **Data integrity on import** — partial failure reporting, re-runnable, no duplicated SKUs.
3. **Operability** — one-command startup, healthchecks, structured logs with correlation ids.
4. **Evolvability** — clear boundaries, versioned contracts, ADRs.
5. **Performance** — paginated lists, indexed search, streaming CSV parsing.

## Internal service architecture (hexagonal / ports & adapters)
```
src/
  domain/          entities, value objects, domain errors, pure logic (no framework imports)
  application/     use cases (commands/queries), ports (interfaces)
  infrastructure/  pg repositories, rabbitmq publishers/consumers, http clients
  interface/       http controllers, DTO mapping, message handlers
```
Dependencies point inward. Domain has zero NestJS/pg imports.

## ADRs
- Location: `docs/adr/NNNN-kebab-title.md`, MADR-lite template:
  `# Title` · `Status` · `Context` · `Decision` · `Alternatives considered` (each with pros/cons) · `Consequences`.
- Write an ADR for: architecture style, DB choice, ORM, messaging, search, money representation, consistency model for checkout, CSV import strategy, frontend stack, monorepo tooling, auth scope.
- README "Decisions" section links to each ADR with a one-line summary.

## C4 diagrams
- Use Mermaid in `docs/architecture.md`: Level 1 (system context), Level 2 (containers: web, gateway, services, postgres, rabbitmq), and a sequence diagram for checkout.

## Design review checklist (use for every design.md)
- [ ] Which context owns the data? Is there exactly one writer?
- [ ] Sync or async? Why? What happens if the other side is down?
- [ ] Idempotency and retries defined?
- [ ] Failure modes and compensations listed?
- [ ] Data model + migrations + indexes defined?
- [ ] API/event contracts in `packages/contracts`?
- [ ] Observability: logs, correlation id, health?
- [ ] Security: input validation, size limits, no secrets in repo?
- [ ] Test plan at each level?
- [ ] Alternatives considered recorded?

## Questions to raise with the user (seed list)
- Is authentication/authorization in scope? (Default assumption: admin vs shopper split without real auth; document it.)
- Multi-currency? (Default: single currency, USD.)
- What happens to existing products on CSV re-import — upsert by SKU or reject duplicates?
- Is a cart required or is "buy now" per product enough?
- Should stock be reserved at checkout start or decremented on payment success?
- Expected catalog size (drives search tech choice)?
