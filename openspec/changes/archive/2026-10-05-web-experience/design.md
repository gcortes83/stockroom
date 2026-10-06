## Context

Decision record: ADR 0008. Feature-specific UI is specified in `product-catalog`, `product-search`, `product-import` and `order-checkout`.

## Goals / Non-Goals

**Goals:** fast first load, clear states, shareable URLs, safe rendering.
**Non-Goals:** offline support.

## Decisions

- **Server state only in TanStack Query**: precise query keys and invalidation after mutations; previous data kept while paging.
- **URL as state** for search, filters and pagination.
- **Design system**: CSS-variable tokens for both themes, glass surfaces, aurora background, gradient accents, Inter and JetBrains Mono bundled locally (no external font requests).
- **Generative product art** from a hash of the SKU plus a category icon, because there are no product images.
- **Performance**: route-level lazy loading and a lazily loaded command palette keep the initial JavaScript around 233 KB gzipped.
- **Safety**: text is only rendered as React text nodes; `dangerouslySetInnerHTML` is banned by lint; nginx sends a strict Content-Security-Policy.

### Alternatives considered

| Option | Trade-off |
|---|---|
| Next.js | SSR, but adds a Node runtime and blurs the gateway boundary |
| MUI | Faster to start, but heavy and opinionated look |
| Redux for server data | Duplicates what TanStack Query provides |

## Risks / Trade-offs

- [Visual effects can hurt contrast and motion sensitivity] → design tokens checked for contrast; reduced-motion preference respected (see the later accessibility change).
