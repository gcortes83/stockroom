---
name: deliverables
description: Submission and documentation standards for the Stockroom code challenge — README structure (decisions, approach, alternatives, run instructions, CSV download date), ADRs, removing code comments, repository hygiene and the final pre-submission checklist. Use when writing README/docs, preparing a commit/PR, or checking whether the challenge is ready to submit.
---

# Deliverables & Documentation

## README.md structure
1. **Overview** — what it is, screenshot/GIF of the UI.
2. **Quick start** — prerequisites (Docker Desktop ≥ 4.x only), `git clone`, `docker compose up --build`, URLs (UI, API docs, RabbitMQ UI), default data.
3. **Example CSV** — source, **date downloaded (YYYY-MM-DD)**, where it lives in the repo, observed data quality issues and how each is handled.
4. **Features** — CRUD, search, import, purchase; with fake payment rules (e.g. card ending 0000 → declined, amounts > X → declined).
5. **Architecture** — C4 container diagram (Mermaid), checkout sequence diagram, service responsibilities.
6. **Decisions** — table: decision · choice · alternatives considered · why · ADR link.
7. **Approach** — how the work was done: spec-driven (OpenSpec), how AI was used and guided, questions asked and assumptions made.
8. **Assumptions & open questions** — explicit list.
9. **Testing** — how to run each level, what is covered.
10. **Local development** — pnpm, hot reload, migrations, resetting data.
11. **Trade-offs, limitations & future work** — auth, real payment provider, dedicated search engine, k8s, observability stack, etc.

## Code comments rule
- Source files must contain no comments. Before every commit run a check, e.g.
  `grep -rnE '^\s*(//|/\*|\*)' --include='*.ts' --include='*.tsx' apps services packages | grep -v node_modules`
  and remove findings. Allowed exceptions: tool directives that must exist (e.g. `/// <reference types="vite/client" />`), license headers are not needed.
- Decision rationale belongs in ADRs and README, not in code.

## Repository hygiene
- `.gitignore` covers node_modules, dist, .env, coverage, test reports, .idea.
- Conventional Commits, small logical commits telling the story (spec → scaffold → feature slices → docs).
- `openspec/` committed: proposals, designs, specs and archived changes show the reasoning process to evaluators.
- No generated artifacts or secrets committed.

## Pre-submission checklist
- [ ] Fresh clone + `docker compose up --build` works on a clean machine; UI reachable.
- [ ] CRUD, search, CSV import and purchase work end to end in the UI.
- [ ] Example CSV included and imports; README states download date.
- [ ] README has decisions, approach, alternatives, run instructions.
- [ ] ADRs present for major decisions.
- [ ] All tests pass; lint/typecheck clean.
- [ ] No code comments; no `console.log`; no TODOs left unexplained.
- [ ] Pushed to a GitHub repository; repo link shared.
