## Why

"UI is required for CRUD, search and purchase." The UI is also where evaluators first judge quality, so it must feel modern ("AI look and feel"), stay understandable in every state, and be safe with hostile catalog data.

## What Changes

- Single-page app served by nginx on the same origin as the API.
- Two areas: Discover (shop) and Studio (admin), with a top navigation bar, a ⌘K command palette and dark/light themes.
- Consistent loading, empty and error states; responsive down to 360 px; generative product artwork.
- Studio orders view to follow every order through the checkout saga.

## Capabilities

### New Capabilities

- `web-storefront`: the shop shell, navigation, theming, product pages and UI quality rules.
- `web-studio`: the admin area, its no-authentication banner and the orders monitoring view.

### Modified Capabilities

None.

## Impact

- apps/web (React 19, Vite, TanStack Query, Tailwind, Radix, cmdk, motion), apps/web/nginx.conf.
- No backend changes.

## Non-goals

- Server-side rendering, user accounts, internationalization.

## Open questions / assumptions

- Smart search is rule-based and presented honestly as such (no LLM).
