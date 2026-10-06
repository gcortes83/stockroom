---
name: frontend-react
description: Frontend standards for the Stockroom web app — React 19 + Vite + TypeScript, TanStack Query, React Router, react-hook-form + zod, Tailwind + shadcn/ui, accessibility, UX for CRUD, search, CSV upload and checkout. Use whenever building or reviewing UI code in apps/web.
---

# Frontend — React

## Structure (feature-sliced)
```
apps/web/src/
  app/            router, providers (QueryClient, Theme, Toaster), layout, error boundary
  features/
    products/     list, detail, create/edit form, delete dialog, api hooks
    search/       search bar, filters, URL-state sync
    import/       CSV upload, progress, row-error report
    checkout/     cart, checkout form, order status page
  shared/
    api/          fetch client (base URL, problem+json parsing, request-id), query keys
    ui/           shadcn components
    lib/          money formatting, debounce, etc.
```

## Rules
- TypeScript strict, no `any`, **no comments**.
- Types and validation schemas come from `@stockroom/contracts` — never redeclare API shapes.
- Server state lives in TanStack Query only; no duplicated copies in useState/Context. Local UI state with useState; URL is the state for search/filter/pagination.
- Query keys from a factory (`productKeys.list(params)`). Mutations invalidate precise keys; use optimistic updates only where rollback is trivial (not for checkout).
- Forms: react-hook-form + zodResolver with the shared schema; map server problem+json `errors[]` back onto fields.
- Money: receive cents, format with `Intl.NumberFormat`; never do float math for totals in the UI — display what the server computes.
- All requests go to the gateway (`VITE_API_URL`), never directly to services.

## UX requirements per feature
- **Products CRUD**: paginated table, create/edit form with inline validation, delete confirmation dialog, 409 conflict handling (duplicate SKU, stale version → offer reload).
- **Search**: debounced (300 ms) input, filters (category, price range, in-stock), sort, pagination, all synced to URL query params; empty state and "no results" state; keep previous data while fetching (`placeholderData: keepPreviousData`).
- **CSV import**: drag & drop + file picker, client-side size/extension check, upload progress, then a job result view: totals (created/updated/failed) and a table of row errors (row number, field, message) with a downloadable error CSV.
- **Purchase**: add to cart (client-side cart persisted in localStorage), checkout form, `Idempotency-Key` generated per checkout attempt, disable double submit, order status page that polls until CONFIRMED/CANCELLED and explains failures (out of stock, payment declined). Document fake card rules on screen.
- Admin vs shopper areas separated by route (`/admin/...` vs `/shop/...`).

## Quality bar
- Every async view has loading (skeletons), error (with retry) and empty states.
- Accessibility: semantic HTML, labelled inputs, focus management in dialogs, keyboard navigable, color contrast AA. Use Testing Library queries by role.
- Error boundary per route. Toasts for mutation results.
- Responsive down to 360px.
- No layout shift on pagination; virtualize only if lists exceed a few hundred rows.

## Testing
- Vitest + Testing Library for components and hooks; MSW to mock the gateway.
- Playwright e2e for the three core journeys (CRUD, search, purchase) against the docker-compose stack.

## Build & runtime
- Vite build → static assets served by nginx in the container; nginx proxies `/api` to the gateway so the browser only knows one origin.
- Env injected at build time via `VITE_*`; keep it to the API base path.
