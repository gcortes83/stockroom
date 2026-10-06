# 0009. No authentication; shop and studio split by route

- Status: accepted
- Date: 2026-10-05

## Context

The challenge does not require authentication and the evaluation focuses on the core domain.

## Decision

`/shop` is public, `/admin` (Studio) is open with a visible banner. No user accounts.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Basic auth at the gateway | Cheap protection | Credentials management adds friction for reviewers |
| OIDC with Keycloak | Production-like | Large setup cost for a demo |

## Consequences

Documented as an accepted risk; the gateway is the place to add an admin role guard later.
