## Purpose

Defines the shopper-facing web experience: how the app is reached, navigated and themed, and the quality bar every page meets.

## ADDED Requirements

### Requirement: Same-origin single-page app

The web app SHALL be served on the same origin as the API (`/api` proxied to the gateway), and unknown client routes MUST render a friendly not-found page.

#### Scenario: Deep link reload
- **WHEN** a user reloads `/shop/products/{id}`
- **THEN** the page loads directly without a server 404

### Requirement: Navigation and command palette

The app SHALL provide navigation between Discover and the Studio areas, a cart badge with the item count, and a command palette opened with ⌘K or Ctrl+K that searches products and jumps to pages.

#### Scenario: Jump to a product
- **WHEN** a user opens the palette, types "running shoes" and selects the product
- **THEN** the product page opens

### Requirement: Themes

The app SHALL offer dark (default) and light themes, remember the choice on the device, and work without storage access.

#### Scenario: Theme persists
- **WHEN** a user switches to the light theme and reloads
- **THEN** the light theme is still active

### Requirement: Clear asynchronous states

Every view that loads data MUST show a loading state, an empty state when there is nothing to show, and an error state with a retry action. Mutations SHALL confirm success or explain failure.

#### Scenario: API unreachable
- **WHEN** the API cannot be reached
- **THEN** the view shows an error message with a "Try again" button instead of a blank page

### Requirement: Safe rendering of catalog data

Product text MUST be rendered as text, never as HTML, and no script contained in data may execute.

#### Scenario: Script-like product name
- **WHEN** a product named `<script>alert('xss')</script>` is displayed
- **THEN** the name appears literally and no browser dialog opens

### Requirement: Responsive layout

All pages SHALL be usable on viewports from 360 px wide, without horizontal page scrolling.

#### Scenario: Mobile search
- **WHEN** a shopper uses smart search on a phone-sized viewport
- **THEN** the search, filter chips and results are usable
