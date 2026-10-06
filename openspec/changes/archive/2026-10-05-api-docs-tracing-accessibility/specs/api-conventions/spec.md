## ADDED Requirements

### Requirement: Machine-readable API documentation

The system SHALL publish an OpenAPI 3.1 description of every public endpoint at `/api/docs/json` and interactive documentation at `/api/docs`. The request and response schemas MUST be derived from the same definitions used for validation.

#### Scenario: Every public route is documented
- **WHEN** the OpenAPI document is generated
- **THEN** it contains `/products`, `/products/{id}`, `/categories`, `/imports`, `/imports/{id}`, `/imports/{id}/issues`, `/payments/methods`, `/orders` and `/orders/{id}`

#### Scenario: Docs render under the content security policy
- **WHEN** a user opens `/api/docs` through the web server
- **THEN** the documentation renders without content-security-policy violations
