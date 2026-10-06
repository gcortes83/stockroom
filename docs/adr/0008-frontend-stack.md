# 0008. React SPA with TanStack Query, Tailwind and Radix

- Status: accepted
- Date: 2026-10-05

## Context

The UI must cover CRUD, search, import and checkout, look modern, and ship as static files behind nginx.

## Decision

React 19 + Vite + React Router 7 (lazy routes) + TanStack Query + react-hook-form/zod + Tailwind 4 + Radix + cmdk + motion. Shared schemas from `@stockroom/contracts`. A deterministic smart-search parser turns phrases like `electronics under $30 in stock` into visible filters.

## Alternatives considered

| Option | Pros | Cons |
|---|---|---|
| Next.js | SSR | Adds a Node runtime and blurs the gateway boundary without user benefit here |
| MUI | Batteries included | Heavy and opinionated look |
| LLM-powered search | Natural language | Needs network and keys; violates the run-locally constraint |

## Consequences

Fast static deployment, initial JS ~233 KB gzipped. The smart search is honest about being rule-based.
