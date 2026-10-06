## ADDED Requirements

### Requirement: Accessibility

The web app MUST have no critical or serious WCAG 2.1 AA violations on the shop, cart, checkout and Studio pages in both themes. It MUST be operable by keyboard, label every form field, manage focus in dialogs, and respect the user's reduced-motion preference.

#### Scenario: Automated audit passes
- **WHEN** an axe audit runs on the shop, cart, checkout, Studio products, new product, imports and orders pages in dark and light themes
- **THEN** no critical or serious violations are reported

#### Scenario: Small text contrast
- **WHEN** secondary text or a status badge is rendered
- **THEN** its contrast ratio against its background is at least 4.5:1
